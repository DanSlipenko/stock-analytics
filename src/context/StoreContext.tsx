'use client';

import React, { createContext, useContext, useReducer, useEffect, useCallback, ReactNode } from 'react';
import { Campaign, PriceAlert, WatchlistItem } from '@/types';

// ---- State shape ----
interface StoreState {
  campaigns: Campaign[];
  alerts: PriceAlert[];
  watchlist: WatchlistItem[];
  loading: boolean;
  triggeredAlerts: PriceAlert[];
}

// ---- Actions ----
type Action =
  | { type: 'SET_CAMPAIGNS'; payload: Campaign[] }
  | { type: 'SET_ALERTS'; payload: PriceAlert[] }
  | { type: 'SET_WATCHLIST'; payload: WatchlistItem[] }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'ADD_CAMPAIGN'; payload: Campaign }
  | { type: 'UPDATE_CAMPAIGN'; payload: Campaign }
  | { type: 'DELETE_CAMPAIGN'; payload: string }
  | { type: 'ADD_ALERT'; payload: PriceAlert }
  | { type: 'UPDATE_ALERT'; payload: PriceAlert }
  | { type: 'DELETE_ALERT'; payload: string }
  | { type: 'ADD_WATCHLIST_ITEM'; payload: WatchlistItem }
  | { type: 'DELETE_WATCHLIST_ITEM'; payload: string }
  | { type: 'ADD_TRIGGERED_ALERT'; payload: PriceAlert };

const initialState: StoreState = {
  campaigns: [],
  alerts: [],
  watchlist: [],
  loading: true,
  triggeredAlerts: [],
};

function reducer(state: StoreState, action: Action): StoreState {
  switch (action.type) {
    case 'SET_CAMPAIGNS':
      return { ...state, campaigns: action.payload };
    case 'SET_ALERTS':
      return { ...state, alerts: action.payload };
    case 'SET_WATCHLIST':
      return { ...state, watchlist: action.payload };
    case 'SET_LOADING':
      return { ...state, loading: action.payload };
    case 'ADD_CAMPAIGN':
      return { ...state, campaigns: [action.payload, ...state.campaigns] };
    case 'UPDATE_CAMPAIGN':
      return {
        ...state,
        campaigns: state.campaigns.map((c) =>
          c._id === action.payload._id ? action.payload : c
        ),
      };
    case 'DELETE_CAMPAIGN':
      return {
        ...state,
        campaigns: state.campaigns.filter((c) => c._id !== action.payload),
      };
    case 'ADD_ALERT':
      return { ...state, alerts: [action.payload, ...state.alerts] };
    case 'UPDATE_ALERT':
      return {
        ...state,
        alerts: state.alerts.map((a) =>
          a._id === action.payload._id ? action.payload : a
        ),
      };
    case 'DELETE_ALERT':
      return {
        ...state,
        alerts: state.alerts.filter((a) => a._id !== action.payload),
      };
    case 'ADD_WATCHLIST_ITEM':
      return { ...state, watchlist: [action.payload, ...state.watchlist] };
    case 'DELETE_WATCHLIST_ITEM':
      return {
        ...state,
        watchlist: state.watchlist.filter((w) => w._id !== action.payload),
      };
    case 'ADD_TRIGGERED_ALERT':
      return {
        ...state,
        triggeredAlerts: [action.payload, ...state.triggeredAlerts].slice(0, 20),
      };
    default:
      return state;
  }
}

// ---- Context ----
interface StoreContextType {
  state: StoreState;
  dispatch: React.Dispatch<Action>;
  fetchCampaigns: () => Promise<void>;
  fetchAlerts: () => Promise<void>;
  fetchWatchlist: () => Promise<void>;
}

const StoreContext = createContext<StoreContextType | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const fetchCampaigns = useCallback(async () => {
    try {
      const res = await fetch('/api/campaigns');
      if (res.ok) {
        const data = await res.json();
        dispatch({ type: 'SET_CAMPAIGNS', payload: data });
      }
    } catch (e) {
      console.error('Failed to fetch campaigns:', e);
    }
  }, []);

  const fetchAlerts = useCallback(async () => {
    try {
      const res = await fetch('/api/alerts');
      if (res.ok) {
        const data = await res.json();
        dispatch({ type: 'SET_ALERTS', payload: data });
      }
    } catch (e) {
      console.error('Failed to fetch alerts:', e);
    }
  }, []);

  const fetchWatchlist = useCallback(async () => {
    try {
      const res = await fetch('/api/watchlist');
      if (res.ok) {
        const data = await res.json();
        dispatch({ type: 'SET_WATCHLIST', payload: data });
      }
    } catch (e) {
      console.error('Failed to fetch watchlist:', e);
    }
  }, []);

  useEffect(() => {
    const loadAll = async () => {
      dispatch({ type: 'SET_LOADING', payload: true });
      await Promise.all([fetchCampaigns(), fetchAlerts(), fetchWatchlist()]);
      dispatch({ type: 'SET_LOADING', payload: false });
    };
    loadAll();
  }, [fetchCampaigns, fetchAlerts, fetchWatchlist]);

  return (
    <StoreContext.Provider value={{ state, dispatch, fetchCampaigns, fetchAlerts, fetchWatchlist }}>
      {children}
    </StoreContext.Provider>
  );
}

export function useStore() {
  const context = useContext(StoreContext);
  if (!context) {
    throw new Error('useStore must be used within a StoreProvider');
  }
  return context;
}
