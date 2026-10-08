
/* Mathside teacher-side secure orphan-file cleanup.
   The Edge Function checks signed-in teacher role and rechecks references before removing files. */
(() => {
  const scan = document.getElementById('msStorageScan');
  const remove = document.getElementById('msStorageDelete');
  const status = document.getElementById('msStorageStatus');
  const count = document.getElementById('msStorageCount');
  const bytes = document.getElementById('msStorageBytes');
  if (!scan || !remove || !status) return;
  const fmt = n => (Number(n) / 1048576).toFixed(2) + ' MB';
  let preview = null;
  async function invoke(action, confirm) {
    if (!db) throw new Error('Supabase is not configured.');
    const { data: { session }, error } = await db.auth.getSession();
    if (error || !session) throw new Error('Please sign in again.');
    const result = await db.functions.invoke('mathside-storage-cleanup', {
      body: {action, min_age_hours:48, ...(confirm ? {confirm} : {})}
    });
    if (result.error) {
      const context = result.error.context;
      let detail = '';
      try { detail = (await context?.json())?.error || ''; } catch {}
      throw new Error(detail || result.error.message || 'Unable to reach the cleanup service.');
    }
    if (result.data?.error) throw new Error(result.data.error);
    return result.data;
  }
  scan.addEventListener('click', async () => {
    scan.disabled = true; remove.disabled = true; preview = null;
    status.textContent = 'Scanning stored solution images…';
    try {
      const data = await invoke('preview');
      preview = data;
      count.textContent = String(data.count || 0);
      bytes.textContent = fmt(data.total_bytes || 0);
      status.textContent = data.count
        ? `${data.count} unreferenced files are eligible. Review before deleting.`
        : 'No eligible unused images found. Your storage is clear.';
      remove.disabled = !(data.count > 0);
    } catch(e) { status.textContent = 'Scan failed: ' + e.message; }
    finally { scan.disabled = false; }
  });
  remove.addEventListener('click', async () => {
    if (!preview?.count || !window.confirm(
      `Permanently delete up to ${preview.count} unused images (${fmt(preview.total_bytes)}) from Supabase Storage? This cannot be undone. Student grade records will remain.`
    )) return;
    scan.disabled = true; remove.disabled = true;
    status.textContent = 'Rechecking and removing unused Storage files…';
    try {
      const result = await invoke('delete', 'DELETE_UNREFERENCED_FILES');
      status.textContent = `${result.deleted || 0} files deleted.${result.errors?.length ? ' ' + result.errors.length + ' files could not be removed.' : ''} Scan again to refresh.`;
      preview = null;
      count.textContent = '—'; bytes.textContent = '—';
    } catch(e) { status.textContent = 'Cleanup failed: ' + e.message; }
    finally { scan.disabled = false; }
  });
})();
