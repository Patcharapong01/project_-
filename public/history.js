document.addEventListener('DOMContentLoaded', () => {
    const historyList = document.getElementById('historyList');
    const searchInput = document.getElementById('searchInput');
    let documents = [];

    function safeCreateIcons() {
        if (window.lucide && typeof lucide.createIcons === 'function') {
            try {
                lucide.createIcons();
            } catch (e) {
                console.warn('Lucide icon warning:', e);
            }
        }
    }

    function applyTheme() {
        const isDark = localStorage.getItem('pl-theme') === 'dark';
        document.body.classList.toggle('dark-theme', isDark);
        if (isDark) {
            document.documentElement.classList.add('dark');
        } else {
            document.documentElement.classList.remove('dark');
        }
        const button = document.getElementById('themeToggle');
        if (button) {
            button.innerHTML = isDark ? '<i data-lucide="sun" class="w-4 h-4 text-amber-400"></i>' : '<i data-lucide="moon" class="w-4 h-4"></i>';
        }
        safeCreateIcons();
    }

    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            const isDark = document.body.classList.toggle('dark-theme');
            localStorage.setItem('pl-theme', isDark ? 'dark' : 'light');
            applyTheme();
        });
    }

    function render() {
        const query = searchInput.value.trim().toLowerCase();
        const filtered = documents.filter(document => `${document.documentId} ${document.originalName}`.toLowerCase().includes(query));
        historyList.innerHTML = '';

        if (filtered.length === 0) {
            historyList.innerHTML = `
                <div class="p-12 text-center text-xs text-slate-400 font-sans flex flex-col items-center justify-center gap-2">
                    <i data-lucide="search-x" class="w-8 h-8 text-slate-300 dark:text-slate-600"></i>
                    <p class="font-medium text-slate-500 dark:text-slate-400">ไม่พบเอกสารที่ตรงกับคำค้นหา</p>
                    <p class="text-[11px] text-slate-400">ลองค้นหาด้วยรหัส Document ID หรือชื่อไฟล์อื่น</p>
                </div>
            `;
            safeCreateIcons();
            return;
        }

        filtered.slice().reverse().forEach(metadata => {
            const row = document.createElement('div');
            row.className = 'px-5 py-4 flex flex-wrap items-center justify-between gap-4 hover:bg-blue-50/40 dark:hover:bg-slate-800/60 transition-all border-b border-slate-100 dark:border-slate-800/60 last:border-0 group';
            
            const details = document.createElement('div');
            details.className = 'min-w-0 flex-1';
            
            const titleRow = document.createElement('div');
            titleRow.className = 'flex flex-wrap items-center gap-2';
            
            const name = document.createElement('p');
            name.className = 'text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100 truncate font-mono group-hover:text-blue-600 dark:group-hover:text-cyan-400 transition-colors';
            name.textContent = metadata.originalName;
            
            const docBadge = document.createElement('span');
            docBadge.className = 'px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950/70 border border-blue-200/80 dark:border-blue-900 text-blue-700 dark:text-cyan-300 text-[10px] font-bold font-mono shrink-0';
            docBadge.textContent = metadata.documentId;
            
            titleRow.append(name, docBadge);

            const info = document.createElement('p');
            info.className = 'text-[11px] text-slate-400 dark:text-slate-500 mt-1 font-mono flex flex-wrap items-center gap-3';
            info.innerHTML = `
                <span class="flex items-center gap-1"><i data-lucide="calendar" class="w-3 h-3 text-slate-400"></i> ${new Date(metadata.confirmedTimestamp || metadata.uploadTimestamp).toLocaleString('th-TH')}</span>
                <span class="flex items-center gap-1"><i data-lucide="file-stack" class="w-3 h-3 text-slate-400"></i> ${metadata.pageCount || '-'} หน้า</span>
                ${metadata.fileSize ? `<span class="flex items-center gap-1"><i data-lucide="hard-drive" class="w-3 h-3 text-slate-400"></i> ${metadata.fileSize}</span>` : ''}
            `;
            
            details.append(titleRow, info);

            const actions = document.createElement('div');
            actions.className = 'flex items-center gap-2 shrink-0';
            
            const review = document.createElement('a');
            review.href = `index.html?documentId=${encodeURIComponent(metadata.documentId)}`;
            review.className = 'px-3.5 py-2 rounded-xl text-xs font-bold text-blue-600 dark:text-cyan-400 bg-blue-50 dark:bg-blue-950/70 border border-blue-200/80 dark:border-blue-900 hover:bg-blue-600 hover:text-white dark:hover:bg-cyan-500 dark:hover:text-slate-950 transition-all flex items-center gap-1.5 shadow-2xs hover:scale-[1.02] active:scale-[0.98]';
            review.innerHTML = '<i data-lucide="eye" class="w-3.5 h-3.5"></i> ตรวจสอบข้อมูล';
            
            const pdf = document.createElement('a');
            pdf.href = `/api/documents/${encodeURIComponent(metadata.documentId)}/file`;
            pdf.target = '_blank';
            pdf.rel = 'noopener';
            pdf.className = 'px-3.5 py-2 rounded-xl text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-200/80 dark:border-emerald-900 hover:bg-emerald-600 hover:text-white dark:hover:bg-emerald-500 dark:hover:text-slate-950 transition-all flex items-center gap-1.5 shadow-2xs hover:scale-[1.02] active:scale-[0.98]';
            pdf.innerHTML = '<i data-lucide="file-text" class="w-3.5 h-3.5"></i> เปิด PDF';
            
            actions.append(review, pdf);
            row.append(details, actions);
            historyList.appendChild(row);
        });

        safeCreateIcons();
    }

    async function load() {
        historyList.innerHTML = `
            <div class="p-12 text-center text-xs text-slate-400 font-sans flex flex-col items-center justify-center gap-3">
                <div class="w-8 h-8 rounded-full border-2 border-blue-200 dark:border-blue-900 border-t-blue-600 animate-spin"></div>
                <span>กำลังโหลดประวัติเอกสาร...</span>
            </div>
        `;
        safeCreateIcons();
        try {
            const response = await fetch('/api/documents');
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error(result.message || 'โหลดข้อมูลไม่สำเร็จ');
            documents = result.documents;
            render();
        } catch (error) {
            historyList.innerHTML = `<div class="p-10 text-center text-xs text-red-500 font-sans flex flex-col items-center gap-1"><i data-lucide="alert-triangle" class="w-6 h-6"></i><span>${error.message}</span></div>`;
            safeCreateIcons();
        }
    }

    function csvValue(value) {
        return `"${String(value ?? '').replace(/"/g, '""')}"`;
    }

    async function exportCsv() {
        const response = await fetch('/api/documents/export');
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error('ไม่สามารถ Export ข้อมูลได้');

        const rows = [['Document ID', 'File Name', 'SAP PO', 'SAP NO.', 'DESCRIPTION', 'BOM', 'BRAND', 'PRODUCTION MODELS', 'TOTAL QTY', 'QTY PCS', 'QTY CTNS', 'N.W.', 'G.W.', 'MEAS.']];
        result.documents.forEach(document => {
            document.items.forEach(item => {
                const prodModels = Array.isArray(item.productionModels)
                    ? item.productionModels.map(m => typeof m === 'object' ? m.desc : m).join(' | ')
                    : '';
                rows.push([
                    document.metadata.documentId,
                    document.metadata.originalName,
                    item.sapPo,
                    item.sapNo,
                    item.description,
                    item.hasBom ? 'พบ' : 'ไม่พบ',
                    item.brand || '',
                    prodModels,
                    item.totalQty,
                    item.qtyPcs,
                    item.qtyCtns,
                    item.nw,
                    item.gw,
                    item.meas
                ]);
            });
        });

        const csv = '\uFEFF' + rows.map(row => row.map(csvValue).join(',')).join('\r\n');
        const link = document.createElement('a');
        link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
        link.download = `packing-list-export-${new Date().toISOString().slice(0, 10)}.csv`;
        link.click();
        URL.revokeObjectURL(link.href);
    }

    searchInput.addEventListener('input', render);
    document.getElementById('refreshBtn').addEventListener('click', load);
    document.getElementById('exportBtn').addEventListener('click', () => exportCsv().catch(error => alert(error.message)));
    applyTheme();
    load();
});
