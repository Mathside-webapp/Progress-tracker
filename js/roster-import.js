/* Flexible SF1 and ordinary school roster importer; no scanning code changes. */
window.GradeDockRosterImport = (() => {
  const str = v => {
    if (v == null) return '';
    if (typeof v === 'object') return str(v.text ?? v.result ?? v.richText?.map(t=>t.text).join('') ?? '');
    return String(v).trim();
  };
  const clean = s => str(s).replace(/\s+/g,' ').trim();
  const key = s => clean(s).toLowerCase().replace(/[^a-z0-9]/g,'');
  const asGender = s => /^(male|males|boy|boys|m)$/i.test(clean(s))?'Male':/^(female|females|girl|girls|f)$/i.test(clean(s))?'Female':'';
  const isHeader = s => /learner|student|last.?name|surname|first.?name|given.?name|middle.?name|\blrn\b|sex|gender|school form|grade|section|remarks|total|no\.|number/i.test(s);
  // DepEd SF1 reader adapted from the actual Mathside student importer.
  // Official SF1 has LRN + learner names, usually MALE first and FEMALE after TOTAL MALE.
  function parseMathsideSF1(rows, sheetName, seen) {
    const cell = v => clean(v);
    const validLRN = v => /^\d{12}$/.test(cell(v).replace(/[^0-9]/g, ''));
    const validName = v => {
      const t = cell(v);
      return t.length >= 3 && /[A-Za-zÀ-ÿÑñ]/.test(t) &&
        !/^(name|student|learner|lrn|sex|gender|birth|age|address|father|mother|guardian|remarks|total)/i.test(t);
    };
    const flat = rows.slice(0,90).flat().map(cell).join(' ').toUpperCase();
    let header=null;
    for(let i=0;i<Math.min(rows.length,90);i++){
      const fields=(rows[i]||[]).map(v=>cell(v).toLowerCase().replace(/\s+/g,' '));
      const lrn=fields.findIndex(v=>/^lrn\b/.test(v));
      const name=fields.findIndex(v=>/^name\b/.test(v)||/^(student|learner)\s+name\b/.test(v)||/^full\s+name\b/.test(v));
      const sex=fields.findIndex(v=>/^sex\b/.test(v)||/^gender\b/.test(v));
      if(name>=0 && (lrn>=0 || sex>=0)){header={row:i,lrn,name,sex};break;}
    }
    const sf1=/SCHOOL FORM 1|SCHOOL REGISTER/.test(flat) ||
      !!(header && header.lrn>=0 && /\bLRN\b/.test(flat));
    if(!sf1) return null;
    const records=[];
    let groupGender=asGender(sheetName)||'Male';
    for(let i=header?header.row+1:0;i<rows.length;i++){
      const cells=(rows[i]||[]).map(cell);
      const text=cells.join(' ').toUpperCase();
      // This transition is how Mathside reads the standard DepEd SF1 without a Gender column.
      if(/\bTOTAL\s+MALES?\b/.test(text)){groupGender='Female';continue;}
      if(/\bTOTAL\s+FEMALES?\b|\bCOMBINED\b/.test(text))break;
      const explicit=cells.find(v=>/^(MALE|FEMALE|MALES|FEMALES)$/i.test(v));
      if(explicit && cells.filter(Boolean).length<=3){groupGender=asGender(explicit)||groupGender;continue;}
      let lrn=header?.lrn??-1;
      if(lrn<0||!validLRN(cells[lrn]))lrn=cells.findIndex(validLRN);
      if(lrn<0)continue;
      let name=header?.name>=0?cell(cells[header.name]):'';
      if(!validName(name)){
        for(let c=lrn+1;c<Math.min(cells.length,lrn+6);c++){
          if(validName(cells[c])){name=cell(cells[c]);break;}
        }
      }
      if(!validName(name))continue;
      const resolved=(header?.sex>=0?asGender(cells[header.sex]):'') ||
        cells.map(asGender).find(Boolean)||groupGender||'Unspecified';
      const identity=key(name);
      if(seen.has(identity))continue;
      seen.add(identity);
      records.push({full_name:name,gender:resolved,lrn:cell(cells[lrn]).replace(/[^0-9]/g,'')});
    }
    return records.length?records:null;
  }
  function parseGrid(rows, sheetName, existing) {
    const seen = existing; const imported=[]; let gender=asGender(sheetName)||'';
    let cols=null;let skipped=0;
    for (const r of rows) {
      const values = r.map(clean); const nonEmpty=values.filter(Boolean);
      if (!nonEmpty.length) continue;
      const heading=nonEmpty.join(' ').trim();
      const section = asGender(heading.replace(/[:\-]/g,''));
      // Many official SF1 files place the section label in a merged heading with other cells.
      const genderCell = nonEmpty.find(v => /^(?:[IVX]+[.\s-]*)?(MALES?|FEMALES?|BOYS|GIRLS)(?:[\s:–-]+(?:LEARNERS?|STUDENTS?|PUPILS?))?$/i.test(v));
      if (genderCell && (nonEmpty.length<=4 || /^(?:[IVX]+[.\s-]*)?(MALE|FEMALE|BOYS|GIRLS)/i.test(nonEmpty[0]))) { gender = /^FEMALE|GIRLS/i.test(genderCell.replace(/^[IVX]+[.\s-]*/i,''))?'Female':'Male'; cols=null; continue; }
      // Common SF1 layouts use a single "MALE"/"FEMALE" cell or a short section heading.
      const sf1Heading = /^(?:[IVX]+[.\s-]*)?(MALE|FEMALE|BOYS|GIRLS)(?:[\s:–-]*(?:LEARNERS?|STUDENTS?|PUPILS?))?\s*$/i.exec(heading);
      if (sf1Heading) { gender=asGender(sf1Heading[1]); cols=null; continue; }
      if (/\bTOTAL\s+MALES?\b/i.test(heading)) { gender='Female'; cols=null; continue; }
      if (/\bTOTAL\s+FEMALES?\b|\bCOMBINED\b/i.test(heading)) { gender=''; cols=null; continue; }
      if (/^(MALE|FEMALE)\s+LEARNERS?$/i.test(heading)) { gender=/^MALE/i.test(heading)?'Male':'Female'; continue; }
      if(section){gender=section;continue;}
      const labels=values.map(key);
      const find = re => labels.findIndex(x=>re.test(x));
      const first=find(/^(firstname|givenname|given)$/),last=find(/^(lastname|surname|familyname)$/),middle=find(/^(middlename|middleinitial|middle)$/);
      const name=find(/^(learners?name|nameoflearner|studentname|nameofstudent|fullname|name)$/);
      const lrn=find(/^(lrn|learnerreferencenumber)$/), sex=find(/^(sex|gender)$/);
      if (first>=0 || last>=0 || name>=0){cols={first,last,middle,name,lrn,sex};continue;}
      if (/^(male|female|males|females|boys|girls)\b/i.test(heading) && nonEmpty.length<=3){ gender=asGender(nonEmpty[0]);continue; }
      if (/school form|school year|grade level|adviser|prepared by|certified|total|page \d+/i.test(heading)) continue;
      const lrnIdx=values.findIndex(x=>/^\d{12}$/.test(x.replace(/[\s-]/g,'')));
      const lrnVal=cols?.lrn>=0 ? values[cols.lrn] : (lrnIdx>=0?values[lrnIdx]:'');
      const lrnValue=/^\d{12}$/.test(lrnVal.replace(/[\s-]/g,'')) ? lrnVal.replace(/[\s-]/g,'') : '';
      let full='';
      if(cols?.first>=0 && cols?.last>=0){const l=values[cols.last],f=values[cols.first],m=cols.middle>=0?values[cols.middle]:'';full=[l,[f,m].filter(Boolean).join(' ')].filter(Boolean).join(', ');}
      else if(cols?.name>=0) full=values[cols.name];
      else {
        const options=values.map((v,i)=>({v,i})).filter(({v,i})=>v && i!==lrnIdx && !/^\d+$/.test(v) && !asGender(v) && !isHeader(v) && /[a-zÀ-ÿ]/i.test(v));
        full=(options.find(({v})=>v.includes(',') || v.split(' ').length>=2) || options.find(({v})=>v.length>=5))?.v||'';
      }
      full=clean(full).replace(/^\d+[.)\-]?\s+/,'');
      if(!full||full.length<4||isHeader(full)||!/[a-zÀ-ÿ]{2,}/i.test(full)){skipped++;continue;}
      const rowGender=cols?.sex>=0?asGender(values[cols.sex]):values.map(asGender).find(Boolean);
      const resolved=rowGender || gender || 'Unspecified';
      const identity=key(full);
      if(seen.has(identity)){skipped++;continue;}
      seen.add(identity);
      imported.push({full_name:full,gender:resolved,lrn:lrnValue});
    }
    return {imported,skipped};
  }
  function csvRows(text) {
    const rows=[];let row=[],val='',quoted=false;
    text=text.replace(/^\ufeff/,'');
    for(let i=0;i<text.length;i++){
      const c=text[i];
      if(c==='"'){if(quoted&&text[i+1]==='"'){val+='"';i++;}else quoted=!quoted;}
      else if(c===','&&!quoted){row.push(val);val='';}
      else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(val);rows.push(row);row=[];val='';}
      else val+=c;
    }
    if(val||row.length){row.push(val);rows.push(row);}
    return rows;
  }
  async function read(file,existing=[]){
    const seen=new Set(existing.map(s=>key(s.full_name||s)));
    let sets=[];
    if(/\.csv$/i.test(file.name)) sets=[{name:'Roster',rows:csvRows(await file.text())}];
    else if(/\.(xlsx|xls)$/i.test(file.name)){
      if(!window.XLSX) throw new Error('The Excel reader has not loaded. Refresh the website and check your internet connection.');
      let workbook;
      try { workbook=XLSX.read(await file.arrayBuffer(), {type:'array',raw:false,cellDates:false}); }
      catch(e) { throw new Error('Excel could not open this file. Try opening it in Excel and using Save As → Excel Workbook (.xlsx). '+(e.message||'')); }
      sets=(workbook.SheetNames||[]).map(name=>({name,rows:XLSX.utils.sheet_to_json(workbook.Sheets[name],{header:1,raw:false,defval:'',blankrows:false})}));
    } else throw new Error('Unsupported format. Please choose an .xls, .xlsx, or .csv file.');
    let result=[];let skipped=0;
    for(const sheet of sets){const sf1=parseMathsideSF1(sheet.rows,sheet.name,seen);if(sf1){result.push(...sf1);continue;}const out=parseGrid(sheet.rows,sheet.name,seen);result.push(...out.imported);skipped+=out.skipped;}
    const rank={Male:0,Female:1,Unspecified:2}; result.sort((a,b)=>rank[a.gender]-rank[b.gender]);
    return {students:result,skipped};
  }
  return {read};
})();
