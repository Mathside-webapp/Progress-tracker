/* Read only declared learner-name columns; never infer names from addresses or parents. */
window.GradeDockRosterImport = (() => {
 const clean=v=>String(v==null?'':v).replace(/\s+/g,' ').trim();
 const key=v=>clean(v).toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
 const gender=v=>/^(male|males|m|boys)$/i.test(clean(v))?'Male':/^(female|females|f|girls)$/i.test(clean(v))?'Female':'';
 const lrn=v=>/^\d{12}$/.test(clean(v).replace(/[ -]/g,''))?clean(v).replace(/[ -]/g,''):'';
 const valid=v=>/[\p{L}]/u.test(v)&&v.length>=2&&!/^(?:total|name|learners? name|students? name|school form|last name|first name|middle name|surname|sex|gender)\b/i.test(v)&&!gender(v);
 function columns(row){
  const ks=row.map(key), find=re=>ks.findIndex(x=>re.test(x));
  return {name:find(/^(?:name|fullname|learners?name|students?name|nameoflearner|nameofstudent)(?:last.*|surname.*)?$/),last:find(/^(?:lastname|surname|familyname)$/),first:find(/^(?:firstname|givenname|givenames|givennames)$/),middle:find(/^(?:middlename|middleinitial|mi)$/),suffix:find(/^(?:suffix|extensionname|nameextension|ext)$/),lrn:find(/^(?:lrn|learnerreferencenumber)$/),sex:find(/^(?:sex|gender)(?:mf)?$/)};
 }
 function parseGrid(rows,sheetName,seen){
  const out=[];let cols=null,group=gender(sheetName),skipped=0;
  const sf1=/school form 1|school register/i.test(rows.slice(0,30).flat().join(' '));
  for(let i=0;i<rows.length;i++){
   const cells=rows[i].map(clean), non=cells.filter(Boolean), text=non.join(' ');
   if(!non.length)continue;
   const found=columns(cells);
   if(found.last>=0&&found.first>=0 || found.name>=0){
    cols={...found,lrn:found.lrn>=0?found.lrn:(cols?.lrn??-1),sex:found.sex>=0?found.sex:(cols?.sex??-1)};
    if(found.name>=0){
      const boundary=cells.findIndex((v,index)=>index>found.name&&!!v);
      cols.nameEnd=boundary>=0?boundary:found.name+1;
      cols.lastFirst=/last\s*name|surname/i.test(cells[found.name]);
    }
    if(sf1&&!group)group='Male';continue;
   }
   // Preserve columns across merged gender headings, subtotal lines and repeated pages.
   if(/\btotal\s+females?\b|\bcombined\b/i.test(text)){group='';continue;}
   if(/\btotal\s+males?\b/i.test(text)){group='Female';continue;}
   const heading=non.find(v=>/^(?:[IVX]+[.\s-]*)?(?:males?|females?|boys|girls)(?:\s+(?:learners?|students?))?[:\s]*$/i.test(v));
   if(heading&&non.every(v=>v===heading||/^\d{1,3}$/.test(v))){group=/female|girls/i.test(heading)?'Female':'Male';continue;}
   if(!cols){if(cells.some(v=>lrn(v)))skipped++;continue;}
   // A name-only subheading can be followed by a second header with the split name columns.
   let name='';
   if(cols.last>=0&&cols.first>=0){
    const last=cells[cols.last]||'',first=cells[cols.first]||'';
    if(!valid(last)||!valid(first)){continue;}
    name=last+', '+[first,cols.middle>=0?cells[cols.middle]:'',cols.suffix>=0?cells[cols.suffix]:''].filter(Boolean).join(' ');
   }else {
    name=cells[cols.name]||'';
    if(cols.nameEnd>cols.name+1){
      const parts=cells.slice(cols.name,cols.nameEnd).filter(Boolean);
      if(parts.length>1&&parts.every(valid))name=cols.lastFirst&&!parts[0].includes(',')?parts[0]+', '+parts.slice(1).join(' '):parts.join(' ');
    }
   }
   if(!valid(name)||/^(?:prepared by|certified|school year|grand total|total)\b/i.test(text)){continue;}
   const id=cols.lrn>=0?lrn(cells[cols.lrn]):'';
   // Official forms require a learner row marker: LRN or numbered row (LRN may be blank).
   if(sf1&&!id&&!cells.slice(0,Math.max(0,cols.name>=0?cols.name:cols.last)).some(v=>/^\d{1,3}[.)]?$/.test(v))){skipped++;continue;}
   const identity=id?'lrn:'+id:'name:'+key(name);
   if(seen.has(identity)||seen.has('name:'+key(name))){skipped++;continue;}
   seen.add(identity);seen.add('name:'+key(name));
   out.push({full_name:name,gender:(cols.sex>=0?gender(cells[cols.sex]):'')||group||'Unspecified',lrn:id});
  }
  return {students:out,skipped};
 }
 function csvRows(text){const rows=[];let row=[],val='',quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){val+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(val);val='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(val);rows.push(row);row=[];val='';}else val+=c;}if(val||row.length){row.push(val);rows.push(row);}return rows;}
 async function read(file,existing=[]){
  const seen=new Set();existing.forEach(s=>{seen.add('name:'+key(s.full_name||s));if(s.lrn)seen.add('lrn:'+lrn(s.lrn));});
  let sheets;
  if(/\.csv$/i.test(file.name))sheets=[{name:'Roster',rows:csvRows((await file.text()).replace(/^\ufeff/,''))}];
  else if(/\.(xlsx|xls)$/i.test(file.name)){
   if(!window.XLSX)throw Error('Excel reader did not load. Refresh with an internet connection.');
   const wb=window.XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:false});
   sheets=wb.SheetNames.map(name=>({name,rows:window.XLSX.utils.sheet_to_json(wb.Sheets[name],{header:1,raw:false,defval:'',blankrows:false})}));
  }else throw Error('Choose an .xlsx, .xls or .csv file.');
  let students=[],skipped=0;
  for(const s of sheets){const r=parseGrid(s.rows,s.name,seen);students.push(...r.students);skipped+=r.skipped;}
  const rank={Male:0,Female:1,Unspecified:2};students.sort((a,b)=>rank[a.gender]-rank[b.gender]||a.full_name.localeCompare(b.full_name));
  return {students,skipped};
 }
 return {read};
})();
