import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { io, type Socket } from 'socket.io-client';
import { getAccessToken, refreshSession } from './api';

interface GroupEvent {
  type: string;
  groupId: string;
}

let socket: Socket | null = null;

/** One socket per session; every group event invalidates that group's cached queries. */
export function useLiveUpdates(enabled: boolean) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;
    socket = io({ auth: (cb) => cb({ token: getAccessToken() }), transports: ['websocket'] });
    socket.on('connect_error', async (err) => {
      if (err.message === 'unauthorized' && (await refreshSession())) socket?.connect();
    });
    socket.on('group:event', (event: GroupEvent) => {
      queryClient.invalidateQueries({ queryKey: ['group', event.groupId] });
      queryClient.invalidateQueries({ queryKey: ['groups'] });
    });
    // Anything missed while disconnected is refetched on reconnect (delivery is at-most-once).
    socket.on('connect', () => queryClient.invalidateQueries());
    return () => {
      socket?.disconnect();
      socket = null;
    };
  }, [enabled, queryClient]);
}

export function joinGroupRoom(groupId: string) {
  socket?.emit('group:join', groupId);
}
