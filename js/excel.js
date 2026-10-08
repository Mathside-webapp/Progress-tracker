(function () {
  const BLUE = 'FF2563EB';
  const BLUE_DARK = 'FF1D4ED8';
  const BLUE_LIGHT = 'FFDBEAFE';
  const YELLOW = 'FFFFF7D6';
  const BORDER = 'FFCBD5E1';
  const TEXT = 'FF172033';
  const MUTED = 'FF475569';
  const MAX_ITEMS = 50;
  const MIN_ITEMS = 5;

  function ensureExcel() {
    if (!window.ExcelJS) throw new Error('Excel tools could not load. Check your internet connection, then reload GradeDock.');
  }

  function clampItems(value) {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n)) return 40;
    return Math.max(MIN_ITEMS, Math.min(MAX_ITEMS, n));
  }

  function normalizeChoiceCount(value) {
    const n = Number(value);
    return n === 5 ? 5 : 4;
  }

  function slug(s) {
    return String(s || 'exam').trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 60) || 'exam';
  }

  function saveBlob(blob, filename) {
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1200);
  }

  function thinBorder(color = BORDER) {
    const side = { style: 'thin', color: { argb: color } };
    return { top: side, left: side, bottom: side, right: side };
  }

  function cellText(cell) {
    const raw = cell?.value;
    if (raw == null) return '';
    if (typeof raw === 'object') {
      if ('text' in raw) return String(raw.text ?? '');
      if ('result' in raw && raw.result != null) return String(raw.result);
      if (Array.isArray(raw.richText)) return raw.richText.map(x => x.text || '').join('');
    }
    return String(raw);
  }

  function parseChoiceCount(value, answers = []) {
    const t = String(value || '').trim().toUpperCase().replace(/–/g, '-');
    if (t.includes('A-E') || t === '5') return 5;
    if (t.includes('A-D') || t === '4') return 4;
    return answers.some(x => String(x).toUpperCase() === 'E') ? 5 : 4;
  }

  async function downloadTemplate(exam = {}, answers = [], teacherName = '') {
    ensureExcel();
    const q = clampItems(exam.question_count || 40);
    const c = normalizeChoiceCount(exam.choice_count || 4);
    const templateMode = !answers.length;
    const choices = Array.from({ length: c }, (_, i) => String.fromCharCode(65 + i));
    const allChoices = ['A', 'B', 'C', 'D', 'E'];
    const wb = new ExcelJS.Workbook();
    wb.creator = 'GradeDock';
    wb.created = new Date();
    wb.properties.subject = 'GradeDock answer key import template';

    const ws = wb.addWorksheet('Answer Key', {
      views: [{ state: 'frozen', ySplit: 7, showGridLines: false }],
      pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
    });

    ws.mergeCells('A1:D1');
    ws.getCell('A1').value = templateMode ? 'GradeDock Dynamic Answer Key Template' : 'GradeDock Answer Key';
    ws.getCell('A1').font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 18 };
    ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
    ws.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(1).height = 28;

    ws.mergeCells('A2:D2');
    ws.getCell('A2').value = templateMode
      ? `Choose Number of Items in D4 (${MIN_ITEMS}–${MAX_ITEMS}) and Choices in D5. The active answer rows automatically follow that selection. Fill only the yellow Correct Answer cells, save, then import into GradeDock.`
      : 'This workbook contains the saved correct answers for this exam. GradeDock reads the item count from D4 when this file is imported.';
    ws.getCell('A2').font = { italic: true, color: { argb: MUTED } };
    ws.getCell('A2').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF1FF' } };
    ws.getCell('A2').alignment = { wrapText: true, vertical: 'middle' };
    ws.getRow(2).height = 38;

    ws.getCell('A4').value = 'Exam Title';
    ws.getCell('B4').value = exam.title || '';
    ws.getCell('C4').value = 'Number of Items';
    ws.getCell('D4').value = q;
    ws.getCell('A5').value = 'Teacher';
    ws.getCell('B5').value = teacherName || '';
    ws.getCell('C5').value = 'Choices';
    ws.getCell('D5').value = `A–${choices[choices.length - 1]}`;

    ['A4', 'C4', 'A5', 'C5'].forEach(addr => {
      const cell = ws.getCell(addr);
      cell.font = { bold: true, color: { argb: 'FF1E3A8A' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE_LIGHT } };
    });
    ['D4', 'D5'].forEach(addr => {
      const cell = ws.getCell(addr);
      cell.font = { bold: true, color: { argb: TEXT } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: YELLOW } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });
    for (let r = 4; r <= 5; r++) for (let col = 1; col <= 4; col++) ws.getCell(r, col).border = thinBorder();

    ws.getCell('D4').dataValidation = {
      type: 'list',
      allowBlank: false,
      formulae: [`"${Array.from({ length: MAX_ITEMS - MIN_ITEMS + 1 }, (_, i) => i + MIN_ITEMS).join(',')}"`],
      showErrorMessage: true,
      errorTitle: 'Invalid item count',
      error: `Choose a number from ${MIN_ITEMS} to ${MAX_ITEMS}.`
    };
    ws.getCell('D5').dataValidation = {
      type: 'list', allowBlank: false, formulae: ['"A–D,A–E"'],
      showErrorMessage: true, errorTitle: 'Invalid choices', error: 'Choose A–D or A–E.'
    };

    const headers = ['Item No.', 'Correct Answer', 'Allowed Choices', 'Notes'];
    headers.forEach((h, i) => {
      const cell = ws.getCell(7, i + 1);
      cell.value = h;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE_DARK } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = thinBorder();
    });
    ws.getRow(7).height = 24;

    // Keep 50 potential rows in the workbook. Formulas and conditional formatting make
    // only the number selected in D4 appear active, without requiring macros.
    for (let i = 0; i < MAX_ITEMS; i++) {
      const row = 8 + i;
      ws.getCell(row, 1).value = { formula: `IF(ROW()-7<=$D$4,ROW()-7,\"\")` };
      ws.getCell(row, 2).value = i < answers.length ? answers[i] : '';
      ws.getCell(row, 3).value = { formula: `IF($A${row}=\"\",\"\",IF($D$5=\"A–E\",\"A, B, C, D, E\",\"A, B, C, D\"))` };
      ws.getCell(row, 4).value = { formula: `IF($A${row}=\"\",\"\",\"Enter one letter only\")` };

      for (let col = 1; col <= 4; col++) {
        const cell = ws.getCell(row, col);
        cell.font = { color: { argb: 'FFFFFFFF' }, bold: col === 2 };
        cell.alignment = { horizontal: col < 4 ? 'center' : 'left', vertical: 'middle' };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
      }
      ws.getCell(row, 2).dataValidation = {
        type: 'list', allowBlank: true, formulae: [`"${allChoices.join(',')}"`],
        showErrorMessage: true, errorTitle: 'Invalid answer', error: 'Enter A, B, C, D, or E. GradeDock will also check the selected A–D/A–E mode.'
      };
    }

    // Active rows visually appear/disappear as D4 changes.
    ws.addConditionalFormatting({
      ref: `A8:D${7 + MAX_ITEMS}`,
      rules: [{
        type: 'expression',
        formulae: ['ROW()-7<=$D$4'],
        style: {
          font: { color: { argb: TEXT } },
          fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFFFFFF' }, fgColor: { argb: 'FFFFFFFF' } },
          border: thinBorder()
        }
      }]
    });
    ws.addConditionalFormatting({
      ref: `B8:B${7 + MAX_ITEMS}`,
      rules: [{
        type: 'expression',
        formulae: ['ROW()-7<=$D$4'],
        style: {
          font: { bold: true, color: { argb: TEXT } },
          fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: YELLOW }, fgColor: { argb: YELLOW } },
          border: thinBorder()
        }
      }]
    });

    // If this is an export of a saved key, use a green answer-cell fill for the current active range.
    if (!templateMode) {
      ws.addConditionalFormatting({
        ref: `B8:B${7 + MAX_ITEMS}`,
        rules: [{
          type: 'expression',
          formulae: ['ROW()-7<=$D$4'],
          style: {
            font: { bold: true, color: { argb: TEXT } },
            fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFE8F8EE' }, fgColor: { argb: 'FFE8F8EE' } },
            border: thinBorder()
          }
        }]
      });
    }

    const noteRow = 60;
    ws.mergeCells(`A${noteRow}:D${noteRow + 1}`);
    ws.getCell(noteRow, 1).value = templateMode
      ? 'GradeDock reads Number of Items from cell D4 and Choices from D5. Answers below the selected item count are ignored. Changing D4 automatically changes which answer rows are active.'
      : 'Keep this answer key for your records. GradeDock compares scanned papers against these saved answers.';
    ws.getCell(noteRow, 1).font = { bold: true, color: { argb: 'FF166534' } };
    ws.getCell(noteRow, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFECFDF5' } };
    ws.getCell(noteRow, 1).alignment = { wrapText: true, vertical: 'middle' };
    ws.getCell(noteRow, 1).border = thinBorder();

    ws.getColumn(1).width = 12;
    ws.getColumn(2).width = 20;
    ws.getColumn(3).width = 23;
    ws.getColumn(4).width = 34;

    const buffer = await wb.xlsx.writeBuffer();
    const suffix = templateMode ? 'Dynamic-Answer-Key-Template' : 'Answer-Key';
    const filenameBase = exam.title ? slug(exam.title) : 'GradeDock';
    saveBlob(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${filenameBase}-${suffix}.xlsx`);
  }

  async function importTemplate(file) {
    ensureExcel();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    const ws = wb.getWorksheet('Answer Key') || wb.worksheets[0];
    if (!ws) throw new Error('No worksheet was found in the Excel file.');

    let questionCount = Number.parseInt(cellText(ws.getCell('D4')).trim(), 10);
    if (!Number.isFinite(questionCount)) {
      // Compatibility with older GradeDock templates: infer from the last completed answer.
      let last = 0;
      for (let i = 0; i < MAX_ITEMS; i++) if (cellText(ws.getCell(8 + i, 2)).trim()) last = i + 1;
      questionCount = last;
    }
    if (!Number.isInteger(questionCount) || questionCount < MIN_ITEMS || questionCount > MAX_ITEMS) {
      throw new Error(`The Excel file must specify ${MIN_ITEMS}–${MAX_ITEMS} items in cell D4.`);
    }

    const rawAnswers = [];
    for (let i = 0; i < questionCount; i++) rawAnswers.push(cellText(ws.getCell(8 + i, 2)).trim().toUpperCase());
    const choiceCount = parseChoiceCount(cellText(ws.getCell('D5')), rawAnswers);
    const allowed = new Set(Array.from({ length: choiceCount }, (_, i) => String.fromCharCode(65 + i)));

    rawAnswers.forEach((value, i) => {
      if (!allowed.has(value)) {
        throw new Error(`Item ${i + 1} is blank or invalid. This workbook is set to A–${String.fromCharCode(64 + choiceCount)}; use only ${[...allowed].join(', ')}.`);
      }
    });

    return {
      answers: rawAnswers,
      questionCount,
      choiceCount,
      title: cellText(ws.getCell('B4')).trim()
    };
  }

  window.GradeDockExcel = { downloadTemplate, importTemplate, MAX_ITEMS, MIN_ITEMS };
})();
