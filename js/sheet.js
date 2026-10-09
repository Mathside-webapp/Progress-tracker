(function () {
  const W = 1000, H = 1414;
  const marker = 30;

  function layout(questionCount = 40, choiceCount = 4) {
    const q = Math.max(1, Number(questionCount || 40));
    const c = Math.max(2, Math.min(5, Number(choiceCount || 4)));
    const columns = q > 25 ? 2 : 1;
    const rows = Math.ceil(q / columns);

    // Scanner coordinates. These same values drive PDF, PNG and OMR detection.
    const rowTop = 356;
    const rowBottom = 1268;
    const rowGap = rows > 1 ? (rowBottom - rowTop) / (rows - 1) : 0;
    const groups = columns === 2 ? [104, 572] : [322];
    const bubbleStart = columns === 2
      ? (c === 5 ? 164 : 178)
      : (c === 5 ? 392 : 410);
    const bubbleGap = c === 5 ? 52 : 64;
    const secondOffset = columns === 2 ? 468 : 0;
    const items = [];

    for (let i = 0; i < q; i++) {
      const col = columns === 2 && i >= rows ? 1 : 0;
      const row = col ? i - rows : i;
      const groupX = groups[col];
      const y = rowTop + row * rowGap;
      const item = { number: i + 1, y, numberX: groupX, groupX, bubbles: [] };
      const startX = bubbleStart + (col ? secondOffset : 0);
      for (let j = 0; j < c; j++) {
        item.bubbles.push({ x: startX + j * bubbleGap, y, choice: String.fromCharCode(65 + j) });
      }
      items.push(item);
    }

    return {
      width: W,
      height: H,
      markerSize: marker,
      markers: [
        { x: 52, y: 52 }, { x: 948, y: 52 },
        { x: 52, y: 1362 }, { x: 948, y: 1362 }
      ],
      items,
      columns,
      rows,
      groups,
      rowTop,
      rowBottom
    };
  }

  function cleanPdfText(value) {
    return String(value ?? '')
      .normalize('NFKD')
      .replace(/[^\x20-\x7E]/g, '?')
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)');
  }

  function downloadBlob(blob, filename) {
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function slug(s) {
    return String(s || 'exam').trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 60) || 'exam';
  }

  function downloadPdf(exam, teacherName = 'Teacher') {
    const q = Number(exam.question_count || 40);
    const c = Number(exam.choice_count || 4);
    const L = layout(q, c);
    const PW = 595.28, PH = 841.89;
    const sx = PW / W, sy = PH / H;
    const x = n => n * sx;
    const y = n => PH - n * sy;
    const commands = [];

    const rect = (cx, cy, w, h, fill = true) => {
      const left = x(cx - w / 2), bottom = y(cy + h / 2), ww = x(w), hh = h * sy;
      commands.push(`${left.toFixed(2)} ${bottom.toFixed(2)} ${ww.toFixed(2)} ${hh.toFixed(2)} re ${fill ? 'f' : 'S'}`);
    };
    const roundedRect = (left, top, w, h, r = 12, fill = false, width = 0.8) => {
      const Lx = x(left), Rx = x(left + w), Ty = y(top), By = y(top + h);
      const rx = x(r), ry = r * sy, k = 0.5522847498;
      const op = fill ? 'f' : 'S';
      commands.push([
        `${width.toFixed(2)} w`,
        `${(Lx + rx).toFixed(2)} ${Ty.toFixed(2)} m`,
        `${(Rx - rx).toFixed(2)} ${Ty.toFixed(2)} l`,
        `${(Rx - rx + k * rx).toFixed(2)} ${Ty.toFixed(2)} ${Rx.toFixed(2)} ${(Ty - ry + k * ry).toFixed(2)} ${Rx.toFixed(2)} ${(Ty - ry).toFixed(2)} c`,
        `${Rx.toFixed(2)} ${(By + ry).toFixed(2)} l`,
        `${Rx.toFixed(2)} ${(By + ry - k * ry).toFixed(2)} ${(Rx - rx + k * rx).toFixed(2)} ${By.toFixed(2)} ${(Rx - rx).toFixed(2)} ${By.toFixed(2)} c`,
        `${(Lx + rx).toFixed(2)} ${By.toFixed(2)} l`,
        `${(Lx + rx - k * rx).toFixed(2)} ${By.toFixed(2)} ${Lx.toFixed(2)} ${(By + ry - k * ry).toFixed(2)} ${Lx.toFixed(2)} ${(By + ry).toFixed(2)} c`,
        `${Lx.toFixed(2)} ${(Ty - ry).toFixed(2)} l`,
        `${Lx.toFixed(2)} ${(Ty - ry + k * ry).toFixed(2)} ${(Lx + rx - k * rx).toFixed(2)} ${Ty.toFixed(2)} ${(Lx + rx).toFixed(2)} ${Ty.toFixed(2)} c`,
        `h ${op}`
      ].join('\n'));
    };
    const line = (x1, y1, x2, y2, width = 0.7) => {
      commands.push(`${width.toFixed(2)} w ${x(x1).toFixed(2)} ${y(y1).toFixed(2)} m ${x(x2).toFixed(2)} ${y(y2).toFixed(2)} l S`);
    };
    const circle = (cx, cy, r = 12) => {
      const rx = x(r), ry = r * sy, k = 0.5522847498;
      const Cx = x(cx), Cy = y(cy);
      commands.push([
        '0.85 w',
        `${(Cx + rx).toFixed(2)} ${Cy.toFixed(2)} m`,
        `${(Cx + rx).toFixed(2)} ${(Cy + k * ry).toFixed(2)} ${(Cx + k * rx).toFixed(2)} ${(Cy + ry).toFixed(2)} ${Cx.toFixed(2)} ${(Cy + ry).toFixed(2)} c`,
        `${(Cx - k * rx).toFixed(2)} ${(Cy + ry).toFixed(2)} ${(Cx - rx).toFixed(2)} ${(Cy + k * ry).toFixed(2)} ${(Cx - rx).toFixed(2)} ${Cy.toFixed(2)} c`,
        `${(Cx - rx).toFixed(2)} ${(Cy - k * ry).toFixed(2)} ${(Cx - k * rx).toFixed(2)} ${(Cy - ry).toFixed(2)} ${Cx.toFixed(2)} ${(Cy - ry).toFixed(2)} c`,
        `${(Cx + k * rx).toFixed(2)} ${(Cy - ry).toFixed(2)} ${(Cx + rx).toFixed(2)} ${(Cy - k * ry).toFixed(2)} ${(Cx + rx).toFixed(2)} ${Cy.toFixed(2)} c S`
      ].join('\n'));
    };
    const text = (value, px, py, size = 9, bold = false, align = 'left') => {
      const s = cleanPdfText(value);
      const approx = s.length * size * 0.51;
      let tx = x(px);
      if (align === 'center') tx -= approx / 2;
      if (align === 'right') tx -= approx;
      commands.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${tx.toFixed(2)} ${y(py).toFixed(2)} Td (${s}) Tj ET`);
    };

    commands.push('0 0 0 rg 0 0 0 RG');

    // Rounded page frame inspired by the user's sample, with scanner markers retained.
    roundedRect(24, 24, 952, 1366, 24, false, 1.2);
    L.markers.forEach(m => rect(m.x, m.y, marker, marker, true));

    text(exam.title || 'Assessment', 500, 98, 23, true, 'center');
    text(`${q}-Item Test | Shade one answer for each item`, 500, 130, 8, false, 'center');

    text('Name:', 72, 184, 8, true);
    line(118, 190, 598, 190, 0.8);
    text('Section:', 630, 184, 8, true);
    line(690, 190, 922, 190, 0.8);

    roundedRect(58, 215, 884, 48, 10, false, 0.7);
    text('Directions: Completely shade one circle for each item. Use a dark pencil or pen.', 78, 244, 7.3, false);
    circle(816, 239, 10);
    text('A', 816, 242, 6.5, true, 'center');
    text('Example', 838, 244, 7.1, false);

    const answerTop = 286, answerBottom = 1320, headerY = 316, headerDividerY = 334;
    const blockX = L.columns === 2 ? [58, 526] : [252];
    const blockW = L.columns === 2 ? 416 : 496;
    blockX.forEach(left => roundedRect(left, answerTop, blockW, answerBottom - answerTop, 15, false, 0.85));
    blockX.forEach(left => line(left + 16, headerDividerY, left + blockW - 16, headerDividerY, 0.55));

    for (let col = 0; col < L.columns; col++) {
      const first = L.items.find(item => item.groupX === L.groups[col]);
      if (!first) continue;
      text('ITEM', first.numberX, headerY, 8.4, true, 'center');
      first.bubbles.forEach(b => text(b.choice, b.x, headerY, 8.4, true, 'center'));
    }

    L.items.forEach((item, idx) => {
      text(String(item.number), item.numberX, item.y + 4, 10.4, true, 'center');
      item.bubbles.forEach(b => {
        circle(b.x, b.y, 12);
        text(b.choice, b.x, b.y + 2.8, 6.6, true, 'center');
      });
      // Soft row divider like the supplied template, but not after the last row in each block.
      const rowInCol = L.columns === 2 && idx >= L.rows ? idx - L.rows : idx;
      if (rowInCol < L.rows - 1) {
        const left = L.columns === 2 ? (idx >= L.rows ? 542 : 74) : 268;
        const right = left + blockW - 32;
        const nextY = item.y + (L.rows > 1 ? (L.rowBottom - L.rowTop) / (L.rows - 1) : 0) / 2;
        line(left, nextY, right, nextY, 0.25);
      }
    });

    text(`${q} items | A-${String.fromCharCode(64 + c)}`, 500, 1355, 6.5, false, 'center');

    const content = commands.join('\n');
    const objects = [];
    objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    objects[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
    objects[3] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`;
    objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
    objects[5] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>';
    objects[6] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;

    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    for (let i = 1; i <= 6; i++) {
      offsets[i] = pdf.length;
      pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
    }
    const xref = pdf.length;
    pdf += 'xref\n0 7\n0000000000 65535 f \n';
    for (let i = 1; i <= 6; i++) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    pdf += `trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;

    downloadBlob(new Blob([pdf], { type: 'application/pdf' }), `${slug(exam.title)}-Answer-Sheet.pdf`);
  }

  function renderCanvas(exam, teacherName = 'Teacher', scale = 2) {
    const q = Number(exam.question_count || 40);
    const c = Number(exam.choice_count || 4);
    const L = layout(q, c);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(W * scale);
    canvas.height = Math.round(H * scale);
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#111';
    ctx.strokeStyle = '#111';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const font = (size, bold = false) => `${bold ? '700' : '400'} ${size}px Arial, Helvetica, sans-serif`;
    const drawText = (value, px, py, size = 12, bold = false, align = 'left') => {
      ctx.font = font(size, bold);
      ctx.textAlign = align;
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(String(value ?? ''), px, py);
    };
    const drawLine = (x1, y1, x2, y2, width = 1, alpha = 1) => {
      ctx.save(); ctx.globalAlpha = alpha; ctx.lineWidth = width;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.restore();
    };
    const drawCircle = (cx, cy, r = 12) => {
      ctx.lineWidth = 1.35;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    };
    const roundRect = (left, top, width, height, radius, lineWidth = 1.2) => {
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(left, top, width, height, radius);
      else {
        const r = Math.min(radius, width / 2, height / 2);
        ctx.moveTo(left + r, top); ctx.lineTo(left + width - r, top);
        ctx.quadraticCurveTo(left + width, top, left + width, top + r);
        ctx.lineTo(left + width, top + height - r);
        ctx.quadraticCurveTo(left + width, top + height, left + width - r, top + height);
        ctx.lineTo(left + r, top + height);
        ctx.quadraticCurveTo(left, top + height, left, top + height - r);
        ctx.lineTo(left, top + r); ctx.quadraticCurveTo(left, top, left + r, top);
      }
      ctx.stroke();
    };

    roundRect(24, 24, 952, 1366, 24, 2);
    L.markers.forEach(m => ctx.fillRect(m.x - marker / 2, m.y - marker / 2, marker, marker));

    drawText(exam.title || 'Assessment', 500, 98, 34, true, 'center');
    drawText(`${q}-Item Test | Shade one answer for each item`, 500, 132, 13, false, 'center');

    drawText('Name:', 72, 184, 13, true);
    drawLine(118, 190, 598, 190, 1.1);
    drawText('Section:', 630, 184, 13, true);
    drawLine(690, 190, 922, 190, 1.1);

    roundRect(58, 215, 884, 48, 10, 1);
    drawText('Directions: Completely shade one circle for each item. Use a dark pencil or pen.', 78, 245, 11, false);
    drawCircle(816, 239, 10);
    drawText('A', 816, 243, 9, true, 'center');
    drawText('Example', 838, 245, 11, false);

    const answerTop = 286, answerBottom = 1320, headerY = 318, headerDividerY = 334;
    const blockX = L.columns === 2 ? [58, 526] : [252];
    const blockW = L.columns === 2 ? 416 : 496;
    blockX.forEach(left => roundRect(left, answerTop, blockW, answerBottom - answerTop, 15, 1.2));
    blockX.forEach(left => drawLine(left + 16, headerDividerY, left + blockW - 16, headerDividerY, 0.9, 0.75));

    for (let col = 0; col < L.columns; col++) {
      const first = L.items.find(item => item.groupX === L.groups[col]);
      if (!first) continue;
      drawText('ITEM', first.numberX, headerY, 12, true, 'center');
      first.bubbles.forEach(b => drawText(b.choice, b.x, headerY, 12, true, 'center'));
    }

    L.items.forEach((item, idx) => {
      drawText(String(item.number), item.numberX, item.y + 5.5, 17, true, 'center');
      item.bubbles.forEach(b => {
        drawCircle(b.x, b.y, 12);
        drawText(b.choice, b.x, b.y + 3.5, 9.5, true, 'center');
      });
      const rowInCol = L.columns === 2 && idx >= L.rows ? idx - L.rows : idx;
      if (rowInCol < L.rows - 1) {
        const left = L.columns === 2 ? (idx >= L.rows ? 542 : 74) : 268;
        const right = left + blockW - 32;
        const nextY = item.y + (L.rows > 1 ? (L.rowBottom - L.rowTop) / (L.rows - 1) : 0) / 2;
        drawLine(left, nextY, right, nextY, 0.7, 0.28);
      }
    });

    drawText(`${q} items | A-${String.fromCharCode(64 + c)}`, 500, 1358, 10, false, 'center');
    return canvas;
  }

  function downloadPng(exam, teacherName = 'Teacher') {
    const canvas = renderCanvas(exam, teacherName, 2);
    return new Promise((resolve,reject)=>canvas.toBlob(blob => {
      if (!blob) return reject(new Error('Could not generate the answer sheet image.'));
      downloadBlob(blob, `${slug(exam.title)}-Answer-Sheet.png`);
      resolve();
    }, 'image/png')); 
  }

  function printableHtml(exam, teacherName = 'Teacher') {
    const q = Number(exam.question_count || 40), c = Number(exam.choice_count || 4);
    const L = layout(q, c);
    const bubbleRows = L.items.map((item, idx) => {
      const opts = item.bubbles.map(b => `<span class="opt" style="left:${b.x / 10}%"><i>${b.choice}</i></span>`).join('');
      const rowInCol = L.columns === 2 && idx >= L.rows ? idx - L.rows : idx;
      const blockLeft = L.columns === 2 ? (idx >= L.rows ? 52.6 : 5.8) : 25.2;
      const blockWidth = L.columns === 2 ? 41.6 : 49.6;
      const divider = rowInCol < L.rows - 1
        ? `<i class="row-divider" style="left:${blockLeft + 1.6}%;width:${blockWidth - 3.2}%;top:${(item.y + ((L.rowBottom - L.rowTop) / Math.max(1, L.rows - 1)) / 2) / 14.14}%"></i>`
        : '';
      return `<div class="qrow" style="top:${item.y / 14.14}%"><span class="qno" style="left:${item.numberX / 10}%">${item.number}</span>${opts}</div>${divider}`;
    }).join('');
    const markers = L.markers.map(m => `<i class="marker" style="left:${(m.x-marker/2)/10}%;top:${(m.y-marker/2)/14.14}%;width:${marker/10}%;height:${marker/14.14}%"></i>`).join('');
    const blocks = L.columns === 2
      ? '<div class="answer-block left"></div><div class="answer-block right"></div>'
      : '<div class="answer-block single"></div>';
    const heads = L.groups.map(groupX => {
      const first = L.items.find(item => item.groupX === groupX);
      if (!first) return '';
      const opts = first.bubbles.map(b => `<span style="left:${b.x/10}%">${b.choice}</span>`).join('');
      return `<div class="col-head"><b style="left:${first.numberX/10}%">ITEM</b>${opts}</div>`;
    }).join('');
    return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(exam.title)} - Answer Sheet</title><style>
      @page{size:A4;margin:0}*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;color:#111;background:#eee}.toolbar{position:fixed;z-index:9;left:0;right:0;top:0;padding:10px;text-align:center;background:#172033;color:#fff}.toolbar button{padding:9px 16px;border:0;border-radius:8px;font-weight:700;cursor:pointer}.sheet{position:relative;width:210mm;height:297mm;margin:55px auto 15px;background:#fff;overflow:hidden;border:0.55mm solid #111;border-radius:5mm}.marker{position:absolute;background:#000}.title{position:absolute;left:8%;right:8%;top:5.2%;text-align:center}.exam{font-size:22pt;font-weight:800;line-height:1.05}.sub{margin-top:2mm;font-size:8.5pt}.meta{display:grid;grid-template-columns:1fr 42mm;gap:9mm;position:absolute;left:7.2%;right:7.8%;top:11.4%;font-size:9pt}.field{display:flex;align-items:flex-end;gap:3mm}.field b{font-size:8pt}.field i{flex:1;border-bottom:0.3mm solid #111;height:6mm}.instructions{position:absolute;left:5.8%;right:5.8%;top:15.2%;height:10.1mm;border:0.25mm solid #555;border-radius:2.4mm;padding:2.4mm 3mm;font-size:7.2pt;display:flex;align-items:center}.example{margin-left:auto;display:flex;align-items:center;gap:2mm}.example i,.opt i{font-style:normal;display:flex;align-items:center;justify-content:center;border:0.3mm solid #111;border-radius:50%;font-weight:700}.example i{width:5mm;height:5mm;font-size:6.5pt}.answer-block{position:absolute;top:20.23%;height:73.13%;border:0.3mm solid #111;border-radius:3mm}.answer-block:after{content:'';position:absolute;left:4%;right:4%;top:4.64%;border-top:0.2mm solid #777}.answer-block.left{left:5.8%;width:41.6%}.answer-block.right{left:52.6%;width:41.6%}.answer-block.single{left:25.2%;width:49.6%}.col-head{position:absolute;inset:0;pointer-events:none;font-size:8pt;font-weight:700}.col-head b,.col-head span{position:absolute;top:22.42%;transform:translate(-50%,-50%)}.qrow{position:absolute;left:0;right:0;height:5mm;transform:translateY(-50%)}.qno{position:absolute;transform:translate(-50%,-50%);top:50%;font-size:11pt;font-weight:800}.opt{position:absolute;transform:translate(-50%,-50%);top:50%}.opt i{width:5.1mm;height:5.1mm;font-size:6.5pt}.row-divider{position:absolute;border-top:0.15mm solid rgba(0,0,0,.18)}.footer{position:absolute;bottom:2.8%;left:10%;right:10%;text-align:center;font-size:6.5pt;color:#555}@media print{body{background:#fff}.toolbar{display:none}.sheet{margin:0}}
    </style></head><body><div class="toolbar"><button onclick="window.print()">Print answer sheet</button></div><main class="sheet">${markers}<div class="title"><div class="exam">${escapeHtml(exam.title)}</div><div class="sub">${q}-Item Test | Shade one answer for each item</div></div><div class="meta"><div class="field"><b>Name:</b><i></i></div><div class="field"><b>Section:</b><i></i></div></div><div class="instructions"><span>Directions: Completely shade one circle for each item. Use a dark pencil or pen.</span><span class="example"><i>A</i> Example</span></div>${blocks}${heads}${bubbleRows}<div class="footer">${q} items | A-${String.fromCharCode(64 + c)}</div></main></body></html>`;
  }

  function escapeHtml(s='') {
    return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
  }

  window.GradeDockSheet = { layout, printableHtml, downloadPdf, downloadPng, renderCanvas, width: W, height: H };
})();
