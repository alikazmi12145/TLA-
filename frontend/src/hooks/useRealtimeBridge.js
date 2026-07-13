/**
 * useRealtimeBridge — mount ONCE at the app root.
 *
 * Subscribes the singleton socket to backend events and translates each
 * one into a React Query cache invalidation. That replaces aggressive
 * per-component polling with push-driven updates: components keep their
 * existing `useQuery` hooks, but instead of a 15 s poll they re-fetch
 * only when the server actually has news.
 *
 * The subscriber list is small and closes over the query client via a
 * ref so we don't re-subscribe on every render. StrictMode double-mount
 * is handled by removing listeners in the cleanup — the second mount
 * simply re-attaches them (still exactly one listener per event).
 */
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSelector } from 'react-redux';
import { getSocket, disconnectSocket } from '../lib/socket';

export function useRealtimeBridge() {
  const qc = useQueryClient();
  const user = useSelector((s) => s.auth.user);
  const isAuthed = !!user?._id;

  useEffect(() => {
    if (!isAuthed) return undefined;
    const socket = getSocket();

    // Attendance: any new punch or import cycle bumps the four cache
    // keys the sidebar / attendance pages / dashboards subscribe to.
    const onAttendance = () => {
      qc.invalidateQueries({ queryKey: ['attendance-today'] });
      qc.invalidateQueries({ queryKey: ['att-today'] });
      qc.invalidateQueries({ queryKey: ['attendance'] });
      qc.invalidateQueries({ queryKey: ['dash-employee'] });
      qc.invalidateQueries({ queryKey: ['dash-admin'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
    };

    // Device health: refresh the devices list + single-device view.
    const onDevice = () => {
      qc.invalidateQueries({ queryKey: ['devices'] });
      qc.invalidateQueries({ queryKey: ['device'] });
    };

    socket.on('attendance-created', onAttendance);
    socket.on('attendance-import-finished', onAttendance);
    socket.on('device-online', onDevice);
    socket.on('device-offline', onDevice);
    socket.on('device-reconnected', onDevice);

    return () => {
      socket.off('attendance-created', onAttendance);
      socket.off('attendance-import-finished', onAttendance);
      socket.off('device-online', onDevice);
      socket.off('device-offline', onDevice);
      socket.off('device-reconnected', onDevice);
    };
  }, [isAuthed, qc]);

  // Disconnect when the user logs out — avoids a lingering socket on the
  // login screen.
  useEffect(() => {
    if (!isAuthed) disconnectSocket();
  }, [isAuthed]);
}
