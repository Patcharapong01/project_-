const express = require('express');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const { createWorker } = require('tesseract.js');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Setup Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Ensure Uploads Directory Exists
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const documentsFile = path.join(uploadDir, 'documents.json');
if (!fs.existsSync(documentsFile)) {
    fs.writeFileSync(documentsFile, '[]', 'utf8');
}

function readDocuments() {
    try {
        return JSON.parse(fs.readFileSync(documentsFile, 'utf8'));
    } catch (error) {
        return [];
    }
}

function writeDocuments(documents) {
    fs.writeFileSync(documentsFile, JSON.stringify(documents, null, 2), 'utf8');
}

// Ensure Sample Data Directory Exists
const sampleDir = path.join(__dirname, 'sample-data');
if (!fs.existsSync(sampleDir)) {
    fs.mkdirSync(sampleDir, { recursive: true });
}

// Multer Setup for Handling File Uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, `${uniqueSuffix}-${file.originalname}`);
    }
});

const fileFilter = (req, file, cb) => {
    if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) {
        cb(null, true);
    } else {
        cb(new Error('INVALID_FILE_TYPE'), false);
    }
};

const upload = multer({ storage, fileFilter });

// Helper: Generate Document ID (PL-YYYYMMDD-XXXX)
let docCounter = 1;
function generateDocumentId() {
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
    const prefix = `PL-${dateStr}-`;
    const existingIds = readDocuments()
        .map(document => document.metadata && document.metadata.documentId)
        .filter(documentId => documentId && documentId.startsWith(prefix));
    const highestSequence = existingIds.reduce((highest, documentId) => {
        const sequence = Number(documentId.slice(prefix.length));
        return Number.isFinite(sequence) ? Math.max(highest, sequence) : highest;
    }, 0);
    let sequence = Math.max(docCounter, highestSequence + 1);
    let documentId = `${prefix}${String(sequence).padStart(4, '0')}`;

    while (existingIds.includes(documentId)) {
        sequence = docCounter++;
        documentId = `${prefix}${String(sequence).padStart(4, '0')}`;
    }

    docCounter = sequence + 1;
    return documentId;
}

async function renderPageWithCoordinates(pageData) {
    const textContent = await pageData.getTextContent({
        normalizeWhitespace: false,
        disableCombineTextItems: true
    });

    return JSON.stringify(textContent.items.map(item => ({
        str: item.str,
        x: item.transform[4],
        y: item.transform[5]
    }))) + '\n---PAGE_BREAK---\n';
}

function parsePackingListCoordinates(pageText) {
    const rawPages = pageText.split('---PAGE_BREAK---').map(p => p.trim()).filter(Boolean);
    const allItems = [];

    rawPages.forEach((rawPage) => {
        let pageItems = [];
        try {
            pageItems = JSON.parse(rawPage);
        } catch (error) {
            return;
        }
        if (!Array.isArray(pageItems) || !pageItems.length) return;

        // Group into visual rows (Y threshold 3.5 points)
        const rows = [];
        pageItems.forEach(item => {
            if (!item.str || !item.str.trim()) return;
            const text = item.str.trim();
            let row = rows.find(r => Math.abs(r.y - item.y) <= 3.5);
            if (!row) {
                row = { y: item.y, cells: [] };
                rows.push(row);
            }
            row.cells.push({ str: text, x: item.x, y: item.y });
        });

        // Sort rows top-to-bottom (higher PDF Y = higher on page)
        rows.sort((a, b) => b.y - a.y);

        // Find primary table header row
        const primaryHeaderKeywords = ['SAP PO', 'SAP NO', 'ITEM NO', 'DESCRIPTION', 'TOTAL QTY', 'QTY (PCS)', 'QTY (CTNS)', 'MEAS', 'PL NO', 'PI NO'];
        let primaryHeaderIdx = -1;

        for (let i = 0; i < Math.min(rows.length, 25); i++) {
            const rowUpper = rows[i].cells.map(c => c.str.toUpperCase()).join(' ');
            const matchCount = primaryHeaderKeywords.filter(kw => rowUpper.includes(kw)).length;
            if (matchCount >= 2 || (rowUpper.includes('SAP') && rowUpper.includes('DESCRIPTION'))) {
                primaryHeaderIdx = i;
                break;
            }
        }

        // Aggregate contiguous sub-header rows (e.g. 1-2 rows before or after primary header row)
        const headerCandidateRows = [];
        let endHeaderIdx = primaryHeaderIdx;

        if (primaryHeaderIdx >= 0) {
            // Check row before (e.g. "TOTAL QTY" on line above)
            if (primaryHeaderIdx > 0) {
                const prevRowText = rows[primaryHeaderIdx - 1].cells.map(c => c.str.toUpperCase()).join(' ');
                if (/TOTAL|QTY|ITEM|SAP|N\.W|G\.W|MEAS/i.test(prevRowText) && !/\b\d{6,8}\b/.test(prevRowText)) {
                    headerCandidateRows.push(rows[primaryHeaderIdx - 1]);
                }
            }

            headerCandidateRows.push(rows[primaryHeaderIdx]);

            // Check row(s) after (e.g. "(PCS)", "(CTNS)")
            for (let j = primaryHeaderIdx + 1; j < Math.min(rows.length, primaryHeaderIdx + 3); j++) {
                const nextRowText = rows[j].cells.map(c => c.str.toUpperCase()).join(' ');
                if (/\((?:PCS|CTNS?|KGS?)\)|(?:PCS|CTNS|MEAS)/i.test(nextRowText) && !/\b\d{6,8}\b/.test(nextRowText)) {
                    headerCandidateRows.push(rows[j]);
                    endHeaderIdx = j;
                } else {
                    break;
                }
            }
        }

        // Build columns from aggregated header cells
        const allHeaderCells = headerCandidateRows.flatMap(r => r.cells);
        const cols = [];

        allHeaderCells.forEach(cell => {
            const u = cell.str.toUpperCase().trim();
            let name = null;
            if (u.includes('ITEM NO') || u === 'ITEM') name = 'itemNo';
            else if (u.includes('P/I') || u.includes('PL NO') || u.includes('PI NO') || u === 'PL') name = 'piNo';
            else if (u.includes('SAP PO') || u.includes('PO NO') || u === 'SAP P') name = 'sapPo';
            else if (u.includes('SAP NO') || u.includes('MATERIAL') || u.includes('SAP N') || u.includes('ITEM CODE')) name = 'sapNo';
            else if (u.includes('DESC') || u.includes('GOODS') || u.includes('SPEC')) name = 'description';
            else if (u.includes('TOTAL QTY') || u.includes('TOTAL')) name = 'totalQty';
            else if (u.includes('QTY (PCS)') || (u.includes('QTY') && cell.x > 400 && cell.x < 440) || u === '(PCS)') name = 'qtyPcs';
            else if (u.includes('QTY (CTNS)') || (u.includes('QTY') && cell.x >= 440 && cell.x < 475) || u === '(CTNS)') name = 'qtyCtns';
            else if (u.includes('N.W') || u === 'NW') name = 'nw';
            else if (u.includes('G.W') || u === 'GW') name = 'gw';
            else if (u.includes('MEAS') || u.includes('CBM')) name = 'meas';

            if (name) {
                const existing = cols.find(c => c.name === name);
                if (!existing) {
                    cols.push({ name, x: cell.x });
                }
            }
        });
        cols.sort((a, b) => a.x - b.x);

        const startRow = endHeaderIdx >= 0 ? endHeaderIdx + 1 : 0;
        let lastItem = null;

        for (let i = startRow; i < rows.length; i++) {
            const row = rows[i];
            row.cells.sort((a, b) => a.x - b.x);
            const rowFullText = row.cells.map(c => c.str).join(' ');

            // Ignore header echoes, shipping marks, footers, total summary
            if (/TOTAL SHIPPED|SHIPPING MARK|COUNTRY OF ORIGIN|PAGE|SIGNATURE|AUTHORIZED/i.test(rowFullText)) {
                continue;
            }
            if (/^Total\b/i.test(rowFullText) && !/\b\d{6,8}\b/.test(rowFullText)) {
                continue;
            }

            const colValues = {
                itemNo: [],
                piNo: [],
                sapPo: [],
                sapNo: [],
                description: [],
                totalQty: [],
                qtyPcs: [],
                qtyCtns: [],
                nw: [],
                gw: [],
                meas: []
            };

            if (cols.length >= 3) {
                row.cells.forEach(cell => {
                    let assignedCol = cols[0].name;
                    for (let c = 0; c < cols.length; c++) {
                        const left = c === 0 ? 0 : (cols[c - 1].x + cols[c].x) / 2;
                        const right = c === cols.length - 1 ? 99999 : (cols[c].x + cols[c + 1].x) / 2;
                        if (cell.x >= left && cell.x < right) {
                            assignedCol = cols[c].name;
                            break;
                        }
                    }
                    colValues[assignedCol].push(cell.str);
                });
            } else {
                // Fallback token classification
                row.cells.forEach(cell => {
                    if (/^\d{6,8}$/.test(cell.str)) colValues.sapNo.push(cell.str);
                    else if (/^\d{4,5}$/.test(cell.str)) colValues.sapPo.push(cell.str);
                    else if (/[A-Za-z]/.test(cell.str)) colValues.description.push(cell.str);
                    else if (/^[\d,]+(\.\d+)?$/.test(cell.str)) colValues.totalQty.push(cell.str);
                });
            }

            // Reassign text cells that were placed in sapNo or piNo but contain descriptive text
            const descKeywords = /[A-Za-z]{3,}/;
            if (colValues.sapNo.length > 1) {
                const pureDigits = [];
                colValues.sapNo.forEach(str => {
                    if (/^\d{5,10}$/.test(str)) pureDigits.push(str);
                    else if (descKeywords.test(str)) colValues.description.unshift(str);
                    else pureDigits.push(str);
                });
                colValues.sapNo = pureDigits;
            }

            let sapNoStr = colValues.sapNo.join('').replace(/\s+/g, '');
            let sapPoStr = colValues.sapPo.join('').replace(/\s+/g, '');
            let descStr = colValues.description.join(' ').trim();
            let totalQtyStr = colValues.totalQty.join('').replace(/,/g, '').trim();
            let qtyPcsStr = colValues.qtyPcs.join('').replace(/,/g, '').trim();
            let qtyCtnsStr = colValues.qtyCtns.join('').replace(/,/g, '').trim();
            let nwStr = colValues.nw.join('').replace(/,/g, '').trim();
            let gwStr = colValues.gw.join('').replace(/,/g, '').trim();
            let measStr = colValues.meas.join('').replace(/,/g, '').trim() || '-';

            // Clean dummy 'x' from descriptions
            if (/^x+$/i.test(descStr)) descStr = '';

            // Check if SAP NO is inside another column or row text
            if (!sapNoStr || !/^\d{6,8}$/.test(sapNoStr)) {
                const sapMatch = sapNoStr.match(/\b\d{6,8}\b/) || rowFullText.match(/\b\d{6,8}\b/);
                if (sapMatch) sapNoStr = sapMatch[0];
            }

            if (!sapPoStr || !/^\d{4,6}$/.test(sapPoStr)) {
                const poMatch = sapPoStr.match(/\b\d{4,5}\b/) || rowFullText.match(/\b\d{4,5}\b/);
                if (poMatch && poMatch[0] !== sapNoStr) sapPoStr = poMatch[0];
            }

            // If this is a valid data row with SAP NO or Description
            if (sapNoStr && (descStr || rowFullText.length > 5)) {
                if (!descStr) {
                    descStr = row.cells.filter(c => /[A-Za-z]/.test(c.str) && !c.str.startsWith('SC-')).map(c => c.str).join(' ').trim();
                }

                const item = {
                    id: allItems.length + 1,
                    sapPo: sapPoStr,
                    sapNo: sapNoStr,
                    description: descStr || '-',
                    totalQty: totalQtyStr,
                    qtyPcs: qtyPcsStr,
                    qtyCtns: qtyCtnsStr,
                    nw: nwStr,
                    gw: gwStr,
                    meas: measStr,
                    status: (sapPoStr && sapNoStr && descStr) ? 'COMPLETE' : 'INCOMPLETE',
                    editedByUser: false
                };
                allItems.push(item);
                lastItem = item;
            } else if (lastItem && descStr) {
                // Multi-line continuation of description
                if (!lastItem.description.includes(descStr)) {
                    lastItem.description += ' ' + descStr;
                }
                if (!lastItem.totalQty && totalQtyStr) lastItem.totalQty = totalQtyStr;
                if (!lastItem.nw && nwStr) lastItem.nw = nwStr;
                if (!lastItem.gw && gwStr) lastItem.gw = gwStr;
            }
        }
    });

    return allItems;
}

// Advanced Parsing Engine for Packing Lists (Text-based)
function parsePackingListText(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const items = [];
    let lastItem = null;
    let pendingItem = null;

    const ignoreKeywords = [
        'INVOICE', 'PACKING LIST', 'SHIP TO', 'SOLD TO', 'PAGE', 'TOTAL', 
        'DESCRIPTION', 'QUANTITY', 'WEIGHT', 'MEASUREMENT', 'ATTN:', 'TEL:', 
        'FAX:', 'REMARK', 'DOKMAI', 'PRAVEJ', 'BANGKOK', 'SECTION', 'SOI',
        'HANGZHOU', 'ROOM ', 'COMETS INTERTRADE', 'SHIPPING MARK',
        'COUNTRY OF ORIGIN', 'TOTAL SHIPPED', 'DATE :', 'TO :'
    ];

    lines.forEach((line) => {
        const upper = line.toUpperCase();
        const isHeader = ignoreKeywords.some(kw => upper === kw || upper.startsWith(`${kw} `));
        if (isHeader) return;

        const sapNoMatches = [...line.matchAll(/\b(?:4\d{6,7}|\d{6,10})\b/g)];
        const sapNoMatch = sapNoMatches.length ? sapNoMatches[sapNoMatches.length - 1] : null;
        const numericOnlyTokens = /^[\d,\.\s]+$/.test(line);

        if (pendingItem && sapNoMatch && line === sapNoMatch[0]) {
            pendingItem.sapNo = sapNoMatch[0];
            return;
        }

        if (!sapNoMatch) {
            if (pendingItem && !numericOnlyTokens) {
                pendingItem.description = line;
                return;
            }
            if (lastItem && numericOnlyTokens) {
                const continuationValues = splitDescriptionAndValues(line).values;
                if (pendingItem && continuationValues.length) {
                    addPackingItem({ ...pendingItem, valueValues: continuationValues });
                    pendingItem = null;
                } else if (!lastItem.totalQty && continuationValues.length) {
                    applyValues(lastItem, continuationValues);
                } else {
                    addPackingItem({
                        sapPo: lastItem.sapPo,
                        sapNo: lastItem.sapNo,
                        description: lastItem.description,
                        valueValues: continuationValues
                    });
                }
            }
            return;
        }

        const sapNo = sapNoMatch[0];
        const prefix = line.slice(0, sapNoMatch.index).trim();
        const suffix = line.slice(sapNoMatch.index + sapNo.length).trim();

        if (sapNoMatch.index === 0 && sapNoMatches.length === 1 && suffix && /[A-Za-z]/.test(suffix)) {
            pendingItem = { sapPo: '', sapNo: '' };
            return;
        }

        const poMatches = prefix.match(/\b\d{4,6}\b/g) || [];
        const sapPo = poMatches.length ? poMatches[poMatches.length - 1] : '';
        const { description, values } = splitDescriptionAndValues(suffix);
        if (!description) {
            pendingItem = { sapPo, sapNo };
            return;
        }
        addPackingItem({ sapPo, sapNo, description, valueValues: values });
    });

    function splitDescriptionAndValues(valueText) {
        let remaining = valueText.trim();
        const decimalValues = [];

        if (/^[\d,\.\s]+$/.test(remaining)) {
            return { description: '', values: splitNumericValues(remaining) };
        }

        const strictTableMatch = remaining.match(/^(\d{1,3}(?:,\d{3})+?)([\d,]+?)(\d+?)(\d+\.\d{2})(\d+\.\d{2})(\d+\.\d{3})$/);

        if (strictTableMatch) {
            return {
                description: '',
                values: strictTableMatch.slice(1).map(value => value.replace(/,/g, ''))
            };
        }

        const compactDecimalMatch = remaining.match(/(\d+\.\d{2})(\d+\.\d{2})(\d+\.\d{3})$/);

        if (compactDecimalMatch) {
            decimalValues.push(compactDecimalMatch[1], compactDecimalMatch[2], compactDecimalMatch[3]);
            remaining = remaining.slice(0, compactDecimalMatch.index).trim();
        }

        const decimalPatterns = [/\d+\.\d{3}\s*$/, /\d+\.\d{2}\s*$/, /\d+\.\d{2}\s*$/];

        if (!compactDecimalMatch) {
            decimalPatterns.forEach(pattern => {
                const match = remaining.match(pattern);
                if (match) {
                    decimalValues.unshift(match[0].trim());
                    remaining = remaining.slice(0, match.index).trim();
                }
            });
        }

        const integerMatch = remaining.match(/(\d[\d,]*)$/);
        if (!integerMatch) return { description: remaining, values: decimalValues };

        const integerText = integerMatch[1].trim();
        const description = remaining.slice(0, integerMatch.index).trim();
        let integerValues = integerText.split(/\s+/);

        if (integerValues.length === 1 && integerValues[0].includes(',')) {
            const compact = integerValues[0];
            const totalMatch = compact.match(/^\d{1,3}(?:,\d{3})+/);
            if (totalMatch) {
                const total = totalMatch[0];
                const remainder = compact.slice(total.length);
                const candidates = [];
                for (let ctnLength = 1; ctnLength <= 3 && ctnLength < remainder.length; ctnLength += 1) {
                    const ctns = remainder.slice(-ctnLength);
                    const pcs = remainder.slice(0, -ctnLength);
                    candidates.push({ pcs, ctns, score: Number(pcs) === Number(total.replace(/,/g, '')) ? 100 : -pcs.length });
                }
                if (candidates.length) {
                    candidates.sort((left, right) => right.score - left.score);
                    integerValues = [total, candidates[0].pcs, candidates[0].ctns];
                }
            }
        } else if (integerValues.length === 1) {
            const compact = integerValues[0];
            const candidates = [];
            for (let ctnLength = 1; ctnLength <= 3 && ctnLength < compact.length; ctnLength += 1) {
                const ctns = compact.slice(-ctnLength);
                const beforeCtns = compact.slice(0, -ctnLength);
                for (let pcsLength = 1; pcsLength <= 5 && pcsLength < beforeCtns.length; pcsLength += 1) {
                    const pcs = beforeCtns.slice(-pcsLength);
                    const total = beforeCtns.slice(0, -pcsLength);
                    if (Number(total) >= Number(pcs)) {
                        candidates.push({ total, pcs, ctns, score: Number(total) === Number(pcs) ? 10 : total.length - pcs.length });
                    }
                }
            }
            if (candidates.length) {
                candidates.sort((left, right) => right.score - left.score);
                integerValues = [candidates[0].total, candidates[0].pcs, candidates[0].ctns];
            }
        }

        return { description, values: integerValues.concat(decimalValues) };
    }

    function splitNumericValues(valueText) {
        let remaining = valueText.replace(/\s+/g, '');
        const values = [];

        for (const decimalPlaces of [3, 2, 2]) {
            const decimalPoint = remaining.lastIndexOf('.');
            if (decimalPoint < 1 || remaining.length - decimalPoint - 1 !== decimalPlaces) return [];
            const previousDecimalPoint = remaining.lastIndexOf('.', decimalPoint - 1);
            let valueStart = previousDecimalPoint >= 0 ? previousDecimalPoint + 3 : decimalPoint - 1;
            if (previousDecimalPoint < 0) {
                while (valueStart >= 0 && /\d/.test(remaining[valueStart])) valueStart -= 1;
                valueStart += 1;
            }
            values.unshift(remaining.slice(valueStart));
            remaining = remaining.slice(0, valueStart);
        }

        if (remaining.includes(',')) {
            const totalMatch = remaining.match(/^\d{1,3}(?:,\d{3})+/);
            if (!totalMatch) return values;
            const total = totalMatch[0];
            const remainder = remaining.slice(total.length);
            const pcsMatch = remainder.match(/^\d{1,3}(?:,\d{3})+/);
            if (pcsMatch) return [total, pcsMatch[0], remainder.slice(pcsMatch[0].length)].concat(values);

            const candidates = [];
            for (let ctnLength = 1; ctnLength <= 3 && ctnLength < remainder.length; ctnLength += 1) {
                const ctns = remainder.slice(-ctnLength);
                const pcs = remainder.slice(0, -ctnLength);
                candidates.push({ pcs, ctns, score: Number(pcs) === Number(total.replace(/,/g, '')) ? 100 : -pcs.length });
            }
            candidates.sort((left, right) => right.score - left.score);
            return candidates.length ? [total, candidates[0].pcs, candidates[0].ctns].concat(values) : values;
        }

        const candidates = [];
        for (let ctnLength = 1; ctnLength <= 3 && ctnLength < remaining.length; ctnLength += 1) {
            const ctns = remaining.slice(-ctnLength);
            const beforeCtns = remaining.slice(0, -ctnLength);
            for (let pcsLength = 1; pcsLength <= 5 && pcsLength < beforeCtns.length; pcsLength += 1) {
                const pcs = beforeCtns.slice(-pcsLength);
                const total = beforeCtns.slice(0, -pcsLength);
                if (Number(total) >= Number(pcs)) {
                    candidates.push({ total, pcs, ctns, score: Number(total) === Number(pcs) ? 100 : -pcs.length });
                }
            }
        }

        candidates.sort((left, right) => right.score - left.score);
        return candidates.length ? [candidates[0].total, candidates[0].pcs, candidates[0].ctns].concat(values) : values;
    }

    function addPackingItem({ sapPo, sapNo, description, valueText, valueValues }) {
        if (!sapNo || !description) return;

        const values = valueText ? valueText.split(/\s+/) : (valueValues || []);
        const normalizedValues = values.map(value => value.replace(/,/g, ''));
        const item = {
            id: items.length + 1,
            sapPo: sapPo || '',
            sapNo,
            description,
            totalQty: '',
            qtyPcs: '',
            qtyCtns: '',
            nw: '',
            gw: '',
            meas: '-',
            status: 'INCOMPLETE',
            editedByUser: false
        };
        applyValues(item, normalizedValues);
        items.push(item);
        lastItem = item;
    }

    function applyValues(item, values) {
        item.totalQty = values[0] || item.totalQty;
        item.qtyPcs = values[1] || item.qtyPcs;
        item.qtyCtns = values[2] || item.qtyCtns;
        item.nw = values[3] || item.nw;
        item.gw = values[4] || item.gw;
        item.meas = values[5] || item.meas;
        item.status = (item.sapPo && item.sapNo && item.description) ? 'COMPLETE' : 'INCOMPLETE';
    }

    return items;
}

async function processOCR(filePath) {
    const { pdf } = await import('pdf-to-img');
    const document = await pdf(filePath, { scale: 3.5, format: 'png' });
    const worker = await createWorker('eng');
    const pageTexts = [];

    try {
        await worker.setParameters({
            tessedit_pageseg_mode: '6',
            preserve_interword_spaces: '1'
        });
        for await (const page of document) {
            const result = await worker.recognize(page);
            pageTexts.push(result.data.text || '');
        }
    } finally {
        await worker.terminate();
        if (typeof document.destroy === 'function') document.destroy();
    }

    return {
        isScanned: true,
        extractedText: pageTexts.join('\n'),
        notice: 'Scanned PDF processed with OCR.'
    };
}

// API: Upload & Process PDF
app.post('/api/upload', (req, res) => {
    upload.single('file')(req, res, async (err) => {
        if (err) {
            if (err.message === 'INVALID_FILE_TYPE') {
                return res.status(400).json({ success: false, message: 'รองรับเฉพาะไฟล์ PDF เท่านั้น' });
            }
            return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการอัปโหลดไฟล์' });
        }

        if (!req.file) {
            return res.status(400).json({ success: false, message: 'กรุณาเลือกไฟล์ PDF' });
        }

        const filePath = req.file.path;

        try {
            const dataBuffer = fs.readFileSync(filePath);
            
            if (!dataBuffer || dataBuffer.length === 0) {
                fs.unlinkSync(filePath);
                return res.status(400).json({ success: false, message: 'ไฟล์ PDF ไม่มีข้อมูลหรือไม่สามารถเปิดได้' });
            }

            let pdfData;
            try {
                pdfData = await pdfParse(dataBuffer, { pagerender: renderPageWithCoordinates });
            } catch (pdfErr) {
                fs.unlinkSync(filePath);
                return res.status(400).json({ success: false, message: 'ไม่สามารถอ่านโครงสร้างไฟล์ PDF ได้ ไฟล์อาจเสียหาย' });
            }

            const rawText = pdfData.text ? pdfData.text.trim() : '';
            let extractedItems = [];
            let processType = 'TEXT_BASED';

            if (rawText.length > 20) {
                extractedItems = parsePackingListCoordinates(rawText);
                
                // Fallback 1: Plain digital text parsing
                if (extractedItems.length === 0) {
                    try {
                        const standardPdf = await pdfParse(dataBuffer);
                        if (standardPdf.text && standardPdf.text.trim().length > 20) {
                            extractedItems = parsePackingListText(standardPdf.text);
                            if (extractedItems.length > 0) {
                                processType = 'TEXT_LAYER';
                            }
                        }
                    } catch (textErr) {
                        console.warn('Standard text extraction fallback failed:', textErr);
                    }
                }

                // Fallback 2: OCR engine
                if (extractedItems.length === 0) {
                    try {
                        const ocrResult = await processOCR(filePath);
                        extractedItems = parsePackingListText(ocrResult.extractedText);
                        processType = 'OCR';
                    } catch (ocrErr) {
                        console.warn('OCR process failed:', ocrErr);
                    }
                }
            } else {
                // Scanned PDF with no digital text layer
                try {
                    const ocrResult = await processOCR(filePath);
                    extractedItems = parsePackingListText(ocrResult.extractedText);
                    processType = 'OCR';
                } catch (ocrErr) {
                    console.warn('OCR process failed:', ocrErr);
                }
            }

            const documentId = generateDocumentId();

            const responsePayload = {
                success: true,
                metadata: {
                    documentId: documentId,
                    originalName: req.file.originalname,
                    uploadTimestamp: new Date().toISOString(),
                    fileSize: (req.file.size / 1024).toFixed(2) + ' KB',
                    pageCount: pdfData.numpages || null,
                    mimeType: req.file.mimetype,
                    storedFileName: req.file.filename,
                    processType: processType,
                    processingStatus: 'PROCESSED'
                },
                items: extractedItems
            };

            return res.json(responsePayload);

        } catch (error) {
            console.error('Extraction Error:', error);
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดภายในระบบในการอ่านข้อมูล PDF' });
        }
    });
});

app.get('/api/documents/latest', (req, res) => {
    const documents = readDocuments();
    return res.json({ success: true, document: documents[documents.length - 1] || null });
});

app.get('/api/documents', (req, res) => {
    const documents = readDocuments().map(document => document.metadata);
    return res.json({ success: true, documents });
});

app.get('/api/documents/export', (req, res) => {
    return res.json({ success: true, documents: readDocuments() });
});

app.get('/api/documents/:documentId', (req, res) => {
    const document = readDocuments().find(item => item.metadata.documentId === req.params.documentId);
    if (!document) {
        return res.status(404).json({ success: false, message: 'ไม่พบเอกสารที่ต้องการ' });
    }
    return res.json({ success: true, document });
});

app.get('/api/documents/:documentId/file', (req, res) => {
    const document = readDocuments().find(item => item.metadata.documentId === req.params.documentId);
    if (!document) {
        return res.status(404).json({ success: false, message: 'ไม่พบเอกสารที่ต้องการ' });
    }

    let storedFileName = document.metadata.storedFileName
        ? path.basename(document.metadata.storedFileName)
        : '';
    let filePath = storedFileName ? path.join(uploadDir, storedFileName) : '';

    if (!filePath || !fs.existsSync(filePath)) {
        const originalName = path.basename(document.metadata.originalName || '');
        const fallbackName = fs.readdirSync(uploadDir).find(fileName => fileName.endsWith(`-${originalName}`));
        storedFileName = fallbackName || '';
        filePath = storedFileName ? path.join(uploadDir, storedFileName) : '';
    }

    if (!filePath || !fs.existsSync(filePath)) {
        return res.status(404).json({ success: false, message: 'ไม่พบไฟล์ PDF ของเอกสารนี้' });
    }

    return res.sendFile(filePath);
});

app.post('/api/documents', (req, res) => {
    const { metadata, items } = req.body;

    if (!metadata || !metadata.documentId || !Array.isArray(items)) {
        return res.status(400).json({ success: false, message: 'ข้อมูลเอกสารไม่ครบถ้วน' });
    }

    const document = {
        metadata: { ...metadata, confirmedTimestamp: new Date().toISOString() },
        items
    };
    const documents = readDocuments();
    const existingIndex = documents.findIndex(item => item.metadata.documentId === metadata.documentId);

    if (existingIndex >= 0) {
        documents[existingIndex] = document;
    } else {
        documents.push(document);
    }

    writeDocuments(documents);
    return res.json({ success: true, document });
});

app.delete('/api/documents/:documentId', (req, res) => {
    const { documentId } = req.params;
    const documents = readDocuments();
    const documentIndex = documents.findIndex(item => item.metadata.documentId === documentId);
    const document = documentIndex >= 0 ? documents[documentIndex] : null;
    const metadata = document ? document.metadata : (req.body && req.body.metadata);
    const storedFileName = metadata && metadata.storedFileName ? path.basename(metadata.storedFileName) : '';
    const originalName = metadata && metadata.originalName ? path.basename(metadata.originalName) : '';

    if (documentIndex >= 0) {
        documents.splice(documentIndex, 1);
        writeDocuments(documents);
    }

    const filesToDelete = fs.readdirSync(uploadDir).filter(fileName => {
        if (fileName === 'documents.json') return false;
        return (storedFileName && fileName === storedFileName) || (originalName && fileName.endsWith(`-${originalName}`));
    });
    filesToDelete.forEach(fileName => fs.unlinkSync(path.join(uploadDir, fileName)));

    return res.json({ success: true, deleted: Boolean(document || filesToDelete.length) });
});

app.listen(PORT, () => {
    console.log(`================================================`);
    console.log(`PL Brand System Backend (Phase 1) Active`);
    console.log(`URL: http://localhost:3000`);
    console.log(`================================================`);
});

