// Branch-Office offline attendance helpers used by SignatureAttendanceView and
// App.jsx. The local read cache + outbox live in the main process (see
// electron/offlineStore.js and its IPC handlers in electron/main.js); this
// module is the renderer-side glue plus the replay logic that pushes queued
// attendance back to Head Office once it's reachable again.
import { ApiClient } from './apiClient.js';

// Cheap reachability check against /api/health (short timeout in main).
export async function pingOnline() {
  try {
    const res = await window.api.pingHeadOffice();
    return !!res.ok;
  } catch (err) {
    return false;
  }
}

export async function getOutboxEntries() {
  const { entries } = await window.api.offlineGetOutbox();
  return entries;
}

function kindOf(entry) {
  return entry.kind || 'attendance';
}

// Pending *attendance* entries recorded by the given officer, newest first —
// used to render "Pending sync" rows in the attendance table. Kept per-officer
// so the table only shows entries the signed-in officer captured. Reference
// signature/photo captures are not table rows and are excluded here.
export async function pendingAttendanceFor(userId, probationerId = null) {
  const entries = await getOutboxEntries();
  return entries
    .filter((e) => kindOf(e) === 'attendance')
    .filter((e) => e.recordedByUserId === userId)
    .filter((e) => probationerId == null || e.probationerId === probationerId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

// Total un-synced items on this PC (attendance + reference captures) — drives
// the "N pending" badge.
export async function outboxCount() {
  return (await getOutboxEntries()).length;
}

// Replays queued captures to Head Office.
//   attendance — only the current officer's own, so the server stamps
//     recorded_by from *their* token and attribution stays correct. A 409
//     means it's already recorded (once-per-month unique constraint) — drop it.
//   referenceSignature / referencePhoto — one-per-probationer overwrite fields
//     with no per-officer attribution, so any online officer can flush them.
// Real failures are left in the queue for the next attempt.
export async function syncOutbox(userId) {
  const result = { synced: 0, alreadyThere: 0, failed: 0 };
  if (!userId || ApiClient.isOffline()) return result;

  for (const entry of await getOutboxEntries()) {
    const kind = kindOf(entry);
    try {
      if (kind === 'attendance') {
        if (entry.recordedByUserId !== userId) continue; // not this officer's to attribute
        await ApiClient.post(`/probationers/${entry.probationerId}/attendance`, {
          logDate: entry.logDate,
          notes: entry.notes,
          gadTopic: entry.gadTopic,
          pngBase64: entry.pngBase64,
        });
      } else if (kind === 'referenceSignature') {
        await ApiClient.post(`/probationers/${entry.probationerId}/signature`, { pngBase64: entry.pngBase64 });
      } else if (kind === 'referencePhoto') {
        await ApiClient.post(`/probationers/${entry.probationerId}/photo`, { dataUrl: entry.dataUrl });
      }
      await window.api.offlineRemoveOutboxEntry(entry.clientId);
      result.synced += 1;
    } catch (err) {
      if (err.status === 409) {
        await window.api.offlineRemoveOutboxEntry(entry.clientId);
        result.alreadyThere += 1;
      } else {
        result.failed += 1; // keep for retry (offline again, or a server error)
      }
    }
  }
  return result;
}
