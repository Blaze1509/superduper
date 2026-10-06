import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, ScrollView, SafeAreaView
} from 'react-native';
import io from 'socket.io-client';

import FirmsScreen from './FirmsScreen';
import GenerateTokenScreen from './GenerateTokenScreen';
import TokensScreen from './TokensScreen';
import { getFirms, getTokens, getApiBaseUrl } from '../api/admin';

export default function DashboardScreen({ onLogout }) {
  const [activePage, setActivePage] = useState('firms'); // 'firms' | 'generate' | 'tokens'
  const [firms, setFirms] = useState([]);
  const [tokens, setTokens] = useState([]);
  const [loading, setLoading] = useState(true);
  const [socketConnected, setSocketConnected] = useState(false);
  const [quickGenFirmId, setQuickGenFirmId] = useState(null);

  const loadData = useCallback(async () => {
    try {
      const [f, t] = await Promise.all([getFirms(), getTokens()]);
      if (f.data && f.data.success) setFirms(f.data.data || []);
      if (t.data && t.data.success) setTokens(t.data.data || []);
    } catch (err) {
      console.log('Load error:', err.response?.status || err.message);
      if (err.response?.status === 401) {
        onLogout();
      }
    } finally {
      setLoading(false);
    }
  }, [onLogout]);

  useEffect(() => {
    loadData();
    const socketUrl = getApiBaseUrl();
    const socket = io(socketUrl, { transports: ['polling', 'websocket'], autoConnect: true });

    socket.on('connect', () => setSocketConnected(true));
    socket.on('disconnect', () => setSocketConnected(false));
    socket.on('tokens_update', (data) => setTokens(data || []));
    socket.on('firms_update', (data) => setFirms(data || []));

    return () => socket.disconnect();
  }, [loadData]);

  const handleNavigateToGenerate = (firmId) => {
    setQuickGenFirmId(firmId);
    setActivePage('generate');
  };

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color="#0f172a" />
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, width: '100%', backgroundColor: '#0f172a' }}>
      <View style={s.container}>
        {/* Top Header Bar */}
        <View style={s.header}>
          <View style={s.headerLeft}>
            <View style={s.brandLogoBox}>
              <Text style={s.brandLogoText}>B</Text>
            </View>
            <View>
              <View style={s.titleRow}>
                <Text style={s.brandTitle}>BLAZE</Text>
                <View style={s.adminBadge}>
                  <Text style={s.adminBadgeText}>ADMIN</Text>
                </View>
              </View>
              <View style={s.liveBadge}>
                <View style={[s.liveDot, { backgroundColor: socketConnected ? '#22c55e' : '#f43f5e' }]} />
                <Text style={s.liveText}>{socketConnected ? 'SYSTEM ONLINE' : 'DISCONNECTED'}</Text>
              </View>
            </View>
          </View>

          {/* Top Right Sign Out Button */}
          <TouchableOpacity onPress={onLogout} style={s.logoutHeaderBtn} activeOpacity={0.85}>
            <Text style={s.logoutHeaderText}>Sign Out</Text>
          </TouchableOpacity>
        </View>

        {/* Enterprise Subnav Tabs */}
        <View style={s.pageNavContainer}>
          <View style={s.navContentWrap}>
            <TouchableOpacity
              style={[s.pageTab, activePage === 'firms' && s.pageTabActive]}
              onPress={() => setActivePage('firms')}
              activeOpacity={0.8}
            >
              <Text style={[s.pageTabText, activePage === 'firms' && s.pageTabTextActive]}>
                Firms ({firms.length})
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[s.pageTab, activePage === 'generate' && s.pageTabActive]}
              onPress={() => setActivePage('generate')}
              activeOpacity={0.8}
            >
              <Text style={[s.pageTabText, activePage === 'generate' && s.pageTabTextActive]}>
                Issue Token
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[s.pageTab, activePage === 'tokens' && s.pageTabActive]}
              onPress={() => setActivePage('tokens')}
              activeOpacity={0.8}
            >
              <Text style={[s.pageTabText, activePage === 'tokens' && s.pageTabTextActive]}>
                Token Registry ({tokens.length})
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Active View Container */}
        <ScrollView contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={true}>
          <View style={s.maxWidthWrap}>
            {activePage === 'firms' && (
              <FirmsScreen
                firms={firms}
                onRefresh={loadData}
                onNavigateToGenerate={handleNavigateToGenerate}
              />
            )}

            {activePage === 'generate' && (
              <GenerateTokenScreen
                firms={firms}
                initialFirmId={quickGenFirmId}
                onTokenGenerated={loadData}
              />
            )}

            {activePage === 'tokens' && (
              <TokensScreen
                tokens={tokens}
                onRefresh={loadData}
              />
            )}
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, width: '100%', backgroundColor: '#f8fafc' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f8fafc' },

  // Header spanning 100% width with space-between positioning Sign Out on top right
  header: {
    flexDirection: 'row',
    justify: 'space-between',
    alignItems: 'center',
    backgroundColor: '#0f172a',
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
    width: '100%',
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 14, flex: 1 },
  brandLogoBox: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#4f46e5',
    alignItems: 'center',
    justify: 'center',
  },
  brandLogoText: { color: '#ffffff', fontWeight: '900', fontSize: 20 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandTitle: { fontSize: 17, fontWeight: '900', color: '#ffffff', letterSpacing: 1.5 },
  adminBadge: { backgroundColor: '#334155', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  adminBadgeText: { color: '#94a3b8', fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  liveBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  liveText: { color: '#64748b', fontSize: 11, fontWeight: '600', letterSpacing: 0.5 },

  logoutHeaderBtn: {
    position: 'absolute',
    right: 24,
    top: 16,
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
    zIndex: 10,
  },
  logoutHeaderText: {
    color: '#cbd5e1',
    fontWeight: '600',
    fontSize: 12,
  },

  // Subnav Bar
  pageNavContainer: {
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    width: '100%',
  },
  navContentWrap: {
    flexDirection: 'row',
    maxWidth: 1000,
    width: '100%',
    alignSelf: 'center',
    paddingHorizontal: 20,
  },
  pageTab: {
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    marginRight: 8,
  },
  pageTabActive: {
    borderBottomColor: '#4f46e5',
  },
  pageTabText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748b',
  },
  pageTabTextActive: {
    color: '#0f172a',
    fontWeight: '700',
  },

  scrollContent: { padding: 24, paddingBottom: 60 },
  maxWidthWrap: { maxWidth: 1000, width: '100%', alignSelf: 'center' },
});
