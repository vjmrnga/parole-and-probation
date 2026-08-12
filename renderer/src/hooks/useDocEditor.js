import { useCallback, useEffect, useRef, useState } from 'react';
import { message } from 'antd';
import { ApiClient } from '../api/apiClient.js';

// Keep in step with STALE_LOCK_MS in server/routes/lockHelpers.js — a lock this
// old is treated as abandoned, so the UI shows the document as free (available
// to take over) rather than stuck "in use" after someone's app crashed.
const STALE_LOCK_MS = 60 * 60 * 1000;

// Interprets a list row's lock columns for the current user. Accepts either
// the snake_case shape the report list endpoints return (locked_by,
// locked_at, locked_by_name) or the camelCase shape the checklist returns
// (lockedBy, lockedAt, lockedByName). Returns:
//   { locked:false }                        — free (or the lock went stale)
//   { locked:true, byMe:true }              — held by the current user
//   { locked:true, byMe:false, name }       — held by someone else
export function lockStatus(row, currentUserId) {
  const lockedBy = row.locked_by ?? row.lockedBy;
  const lockedAt = row.locked_at ?? row.lockedAt;
  const lockedByName = row.locked_by_name ?? row.lockedByName;
  if (!lockedBy) return { locked: false };
  const stale = !lockedAt || Date.now() - new Date(lockedAt).getTime() > STALE_LOCK_MS;
  if (stale) return { locked: false };
  return { locked: true, byMe: String(lockedBy) === String(currentUserId), name: lockedByName };
}

// Shared "edit in place" controller used by every list that shows editable
// documents (PSIR, Final Report, Records Check, and the case document
// checklist). It ties together the three moving parts:
//
//   1. Check the document out server-side (POST <lockPath>) so no one else can
//      edit it at the same time — the office chose a one-editor-at-a-time lock.
//   2. Download its bytes and hand them to the Electron main process, which
//      opens them in Word/Acrobat/etc. and watches the file for saves
//      (window.api.docEditOpen — see electron/docEditWatcher.js).
//   3. On each save, main pushes the new bytes back via 'doc-edit-changed';
//      we PUT them to <uploadPath> so every office sees the update, then when
//      the user clicks "Done" we release the lock (DELETE <lockPath>).
//
// Callers supply the endpoint shapes because the checklist differs from the
// report tables (nested path, dataUrl vs. base64 download):
//
//   keyPrefix     stable namespace for this list, e.g. 'psir' — combined with
//                 the row id into the watch key 'psir:42'.
//   lockPath(id)  POST to acquire / DELETE to release the lock.
//   uploadPath(id)PUT { base64 } to overwrite the stored file.
//   downloadFile(id) -> { base64, filename }  fetch the current bytes + name.
//   onSaved()     optional; after a successful auto-save (e.g. toast/refresh).
//   onReleased()  optional; after a lock is released (refresh the list so the
//                 "in use" badge clears).
export function useDocEditor({ keyPrefix, lockPath, uploadPath, downloadFile, onSaved, onReleased }) {
  const [editingIds, setEditingIds] = useState([]);
  const [busyId, setBusyId] = useState(null);

  // The 'doc-edit-changed' / 'doc-edit-closed' listeners are registered once
  // but need live access to which ids are still being edited and the current
  // config, so mirror them into refs.
  const editingRef = useRef(new Set());
  const cfgRef = useRef({ keyPrefix, uploadPath, lockPath, onSaved, onReleased });
  cfgRef.current = { keyPrefix, uploadPath, lockPath, onSaved, onReleased };

  const watchKey = useCallback((id) => `${keyPrefix}:${id}`, [keyPrefix]);

  useEffect(() => {
    if (!window.api?.onDocEditChanged) return undefined;
    const unsubscribe = window.api.onDocEditChanged(async ({ key, base64 }) => {
      const { keyPrefix: prefix, uploadPath: upload, onSaved: saved } = cfgRef.current;
      const prefixDot = `${prefix}:`;
      if (!key.startsWith(prefixDot)) return; // event for a different list's hook
      const id = key.slice(prefixDot.length);
      if (!editingRef.current.has(String(id))) return; // already stopped editing
      try {
        await ApiClient.put(upload(id), { base64 });
        message.success('Changes saved.', 1.5);
        if (saved) saved(id);
      } catch (err) {
        message.error(err.message);
      }
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The main process fires 'doc-edit-closed' when it detects the editor was
  // closed. Release the lock automatically so the user doesn't have to click
  // "Done editing" — the watcher has already stopped, so we only clear our own
  // state and drop the server-side lock.
  useEffect(() => {
    if (!window.api?.onDocEditClosed) return undefined;
    const unsubscribe = window.api.onDocEditClosed(async ({ key }) => {
      const { keyPrefix: prefix, lockPath: lock, onReleased: released } = cfgRef.current;
      const prefixDot = `${prefix}:`;
      if (!key.startsWith(prefixDot)) return; // event for a different list's hook
      const id = key.slice(prefixDot.length);
      if (!editingRef.current.has(String(id))) return; // already released
      editingRef.current.delete(String(id));
      setEditingIds((prev) => prev.filter((x) => x !== String(id)));
      try {
        await ApiClient.delete(lock(id));
        message.success('Document closed — released for others.', 2);
      } catch (err) {
        message.error(err.message);
      }
      if (released) released(id);
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startEdit = useCallback(async (id) => {
    setBusyId(id);
    try {
      await ApiClient.post(lockPath(id));
      const { base64, filename } = await downloadFile(id);
      const result = await window.api.docEditOpen(watchKey(id), base64, filename);
      if (!result.ok) {
        // Opening/watching failed — don't leave the document checked out.
        await ApiClient.delete(lockPath(id)).catch(() => {});
        throw new Error(result.error || 'Could not open the document for editing.');
      }
      editingRef.current.add(String(id));
      setEditingIds((prev) => [...new Set([...prev, String(id)])]);
      message.info('Opened for editing — your saves sync automatically, and it releases when you close the file.', 4);
    } catch (err) {
      message.error(err.message);
    } finally {
      setBusyId(null);
    }
  }, [lockPath, downloadFile, watchKey]);

  const stopEdit = useCallback(async (id) => {
    setBusyId(id);
    try {
      editingRef.current.delete(String(id));
      setEditingIds((prev) => prev.filter((x) => x !== String(id)));
      await window.api.docEditStop(watchKey(id));
      await ApiClient.delete(lockPath(id));
      message.success('Done editing — the document is now free for others.');
      if (onReleased) onReleased(id);
    } catch (err) {
      message.error(err.message);
    } finally {
      setBusyId(null);
    }
  }, [lockPath, watchKey, onReleased]);

  const isEditing = useCallback((id) => editingIds.includes(String(id)), [editingIds]);

  return { startEdit, stopEdit, isEditing, busyId, editingIds };
}
