import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchPositions, deletePosition } from '../services/earnService';
import type { EarnPositionRecord } from '../types';

export function useEarnPortfolio(walletAddress: string | null) {
  const [positions, setPositions] = useState<EarnPositionRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const lastAddress = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    if (!walletAddress) {
      setPositions([]);
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await fetchPositions(walletAddress);
      setPositions(res.positions ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load positions');
    } finally {
      setLoading(false);
    }
  }, [walletAddress]);

  // Auto-fetch when wallet changes
  useEffect(() => {
    if (walletAddress && walletAddress !== lastAddress.current) {
      lastAddress.current = walletAddress;
      refresh();
    }
    if (!walletAddress) {
      lastAddress.current = null;
      setPositions([]);
    }
  }, [walletAddress, refresh]);

  const removePosition = useCallback(async (id: string) => {
    try {
      await deletePosition(id);
      setPositions((prev) => prev.filter((p) => p._id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove position');
    }
  }, []);

  return {
    positions,
    loading,
    error,
    refresh,
    removePosition,
  };
}
