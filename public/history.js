document.addEventListener('DOMContentLoaded', () => {
    const historyList = document.getElementById('historyList');
    const searchInput = document.getElementById('searchInput');
    let documents = [];

    function applyTheme() {
        const isDark = localStorage.getItem('pl-theme') === 'dark';
        document.body.classList.toggle('dark-theme', isDark);
        if (isDark) {
            document.documentElement.classList.add('dark');
        } else {
            document.documentElement.classList.remove('dark');
        }
        const button = document.getElementById('themeToggle');
        button.innerHTML = isDark ? '<i data-lucide="sun" class="w-4 h-4 text-amber-400"></i>' : '<i data-lucide="moon" class="w-4 h-4"></i>';
        lucide.createIcons();
    }

    document.getElementById('themeToggle').addEventListener('click', () => {
        const isDark = document.body.classList.toggle('dark-theme');
        localStorage.setItem('pl-theme', isDark ? 'dark' : 'light');
        applyTheme();
    });

    function render() {
        const query = searchInput.value.trim().toLowerCase();
        const filtered = documents.filter(document => `${document.documentId} ${document.originalName}`.toLowerCase().includes(query));
        historyList.innerHTML = '';

        if (filtered.length === 0) {
            historyList.innerHTML = '<p class="p-10 text-center text-xs text-slate-400 font-sans">ไม่พบเอกสารที่ตรงกับคำค้นหา</p>';
            return;
        }

        filtered.slice().reverse().forEach(metadata => {
            const row = document.createElement('div');
            row.className = 'px-5 py-3.5 flex flex-wrap items-center justify-between gap-4 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors';
            
            const details = document.createElement('div');
            details.className = 'min-w-0 flex-1';
            const name = document.createElement('p');
            name.className = 'text-xs font-bold text-slate-800 dark:text-slate-100 truncate font-mono';
            name.textContent = metadata.originalName;
            const info = document.createElement('p');
            info.className = 'text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 font-mono';
            info.textContent = `${metadata.documentId} · บันทึกเมื่อ ${new Date(metadata.confirmedTimestamp || metadata.uploadTimestamp).toLocaleString('th-TH')} · ${metadata.pageCount || '-'} หน้า`;
            details.append(name, info);

            const actions = document.createElement('div');
            actions.className = 'flex items-center gap-2 shrink-0';
            
            const review = document.createElement('a');
            review.href = `index.html?documentId=${encodeURIComponent(metadata.documentId)}`;
            review.className = 'px-3 py-1.5 rounded-lg text-xs font-semibold text-blue-600 dark:text-cyan-400 bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-900 hover:bg-blue-100 dark:hover:bg-blue-900 transition-colors flex items-center gap-1';
            review.innerHTML = '<i data-lucide="eye" class="w-3.5 h-3.5"></i> ตรวจสอบข้อมูล';
            
            const pdf = document.createElement('a');
            pdf.href = `/api/documents/${encodeURIComponent(metadata.documentId)}/file`;
            pdf.target = '_blank';
            pdf.rel = 'noopener';
            pdf.className = 'px-3 py-1.5 rounded-lg text-xs font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-900 hover:bg-emerald-100 dark:hover:bg-emerald-900 transition-colors flex items-center gap-1';
            pdf.innerHTML = '<i data-lucide="file-text" class="w-3.5 h-3.5"></i> เปิด PDF';
            
            actions.append(review, pdf);
            row.append(details, actions);
            historyList.appendChild(row);
        });

        lucide.createIcons();
    }

    async function load() {
        historyList.innerHTML = '<p class="p-10 text-center text-xs text-slate-400 font-sans">กำลังโหลดประวัติ...</p>';
        try {
            const response = await fetch('/api/documents');
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error(result.message || 'โหลดข้อมูลไม่สำเร็จ');
            documents = result.documents;
            render();
        } catch (error) {
            historyList.innerHTML = `<p class="p-10 text-center text-xs text-red-500 font-sans">${error.message}</p>`;
        }
    }

    function csvValue(value) {
        return `"${String(value ?? '').replace(/"/g, '""')}"`;
    }

    async function exportCsv() {
        const response = await fetch('/api/documents/export');
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error('ไม่สามารถ Export ข้อมูลได้');

        const rows = [['Document ID', 'File Name', 'SAP PO', 'SAP NO.', 'DESCRIPTION', 'TOTAL QTY', 'QTY PCS', 'QTY CTNS', 'N.W.', 'G.W.', 'MEAS.']];
        result.documents.forEach(document => {
            document.items.forEach(item => rows.push([
                document.metadata.documentId,
                document.metadata.originalName,
                item.sapPo,
                item.sapNo,
                item.description,
                item.totalQty,
                item.qtyPcs,
                item.qtyCtns,
                item.nw,
                item.gw,
                item.meas
            ]));
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
