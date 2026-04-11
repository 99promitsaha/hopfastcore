import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchVaults } from '../services/earnService';
import type { EarnVault, EarnFilters } from '../types';

export function useEarnVaults() {
  const [allVaults, setAllVaults] = useState<EarnVault[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [total, setTotal] = useState(0);
  const cursorRef = useRef<string | null>(null);
  const hasMoreRef = useRef(true);
  const loadedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const [filters, setFilters] = useState<EarnFilters>({
    chainId: null,
    stablecoinOnly: true,
    sortBy: 'apy',
    search: '',
    protocol: null,
    asset: null,
  });

  const loadVaults = useCallback(async (
    currentFilters: EarnFilters,
    reset: boolean,
  ) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setLoading(true);
    setError('');

    try {
      const cursor = reset ? undefined : (cursorRef.current ?? undefined);
      // Determine asset filter: explicit asset filter takes priority, then stablecoin toggle
      const assetFilter = currentFilters.asset
        ?? (currentFilters.stablecoinOnly ? 'USDC' : undefined);

      const res = await fetchVaults({
        chainId: currentFilters.chainId ?? undefined,
        sortBy: currentFilters.sortBy,
        asset: assetFilter,
        protocol: currentFilters.protocol ?? undefined,
        minTvlUsd: 10_000,
        cursor,
        limit: 50,
      });

      if (ctrl.signal.aborted) return;

      setTotal(res.total);
      cursorRef.current = res.nextCursor;
      hasMoreRef.current = res.nextCursor != null && res.data.length > 0;

      if (reset) {
        setAllVaults(res.data);
      } else {
        setAllVaults((prev) => [...prev, ...res.data]);
      }
    } catch (err) {
      if (ctrl.signal.aborted) return;
      setError(err instanceof Error ? err.message : 'Failed to load vaults');
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!loadedRef.current) {
      loadedRef.current = true;
      loadVaults(filters, true);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Reload when server-side filters change (chain, sort, stablecoin)
  const updateFilters = useCallback((patch: Partial<EarnFilters>) => {
    setFilters((prev) => {
      const next = { ...prev, ...patch };

      // These filters require a fresh API call
      const serverFilterChanged =
        (patch.chainId !== undefined && patch.chainId !== prev.chainId) ||
        (patch.sortBy !== undefined && patch.sortBy !== prev.sortBy) ||
        (patch.stablecoinOnly !== undefined && patch.stablecoinOnly !== prev.stablecoinOnly) ||
        (patch.protocol !== undefined && patch.protocol !== prev.protocol) ||
        (patch.asset !== undefined && patch.asset !== prev.asset);

      if (serverFilterChanged) {
        cursorRef.current = null;
        hasMoreRef.current = true;
        loadVaults(next, true);
      }

      return next;
    });
  }, [loadVaults]);

  const loadMore = useCallback(() => {
    if (hasMoreRef.current && !loading) {
      loadVaults(filters, false);
    }
  }, [loading, filters, loadVaults]);

  const filteredVaults = allVaults.filter((v) => {
    if (!v.isTransactional) return false;
    if (filters.search) {
      const q = filters.search.toLowerCase();
      const matchesName = v.name.toLowerCase().includes(q);
      const matchesProtocol = v.protocol.name.toLowerCase().includes(q);
      const matchesToken = v.underlyingTokens.some((t) => t.symbol.toLowerCase().includes(q));
      if (!matchesName && !matchesProtocol && !matchesToken) return false;
    }
    return true;
  });

  return {
    vaults: filteredVaults,
    allCount: total,
    loading,
    error,
    filters,
    updateFilters,
    loadMore,
    hasMore: hasMoreRef.current,
  };
}
