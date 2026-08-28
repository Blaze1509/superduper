import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert, Animated, Platform
} from 'react-native';
import { addFirm, deleteFirm } from '../api/admin';

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function FirmsScreen({ firms, onRefresh, onNavigateToGenerate }) {
  const [newFirmName, setNewFirmName] = useState('');
  const [addingFirm, setAddingFirm] = useState(false);

  // Enter animation
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(15)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 250, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]).start();
  }, [fadeAnim, slideAnim]);

  const handleAddFirm = async () => {
    if (!newFirmName.trim()) return;
    setAddingFirm(true);
    try {
      await addFirm(newFirmName.trim());
      setNewFirmName('');
      onRefresh();
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Failed to add organization';
      if (Platform.OS === 'web') alert(msg);
      else Alert.alert('Error', msg);
    } finally {
      setAddingFirm(false);
    }
  };

  const handleDeleteFirm = (firm) => {
    const msg = `Delete organization "${firm.name}"? All associated data will be removed.`;
    if (Platform.OS === 'web') {
      if (window.confirm(msg)) {
        deleteFirm(firm.id).then(() => onRefresh());
      }
    } else {
      Alert.alert('Delete Organization', msg, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive', onPress: async () => {
            try { await deleteFirm(firm.id); onRefresh(); }
            catch (err) { Alert.alert('Error', err.response?.data?.error || 'Failed to delete'); }
          }
        }
      ]);
    }
  };

  return (
    <Animated.View style={[s.container, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
      <View style={s.card}>
        <View style={s.headerBlock}>
          <Text style={s.pageTitle}>Firms & Organizations</Text>
          <Text style={s.pageSub}>Manage client accounts, view registration timestamps, and issue tokens.</Text>
        </View>

        {/* Add Firm Bar */}
        <View style={s.addFormRow}>
          <TextInput
            style={s.input}
            placeholder="Enter firm name..."
            placeholderTextColor="#94a3b8"
            value={newFirmName}
            onChangeText={setNewFirmName}
            onSubmitEditing={handleAddFirm}
          />
          <TouchableOpacity
            style={[s.btnPrimary, addingFirm && s.btnDisabled]}
            onPress={handleAddFirm}
            disabled={addingFirm}
            activeOpacity={0.85}
          >
            {addingFirm ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.btnPrimaryText}>Add Firm</Text>}
          </TouchableOpacity>
        </View>

        {/* Firm Listing */}
        {(!firms || firms.length === 0) ? (
          <View style={s.emptyBox}>
            <Text style={s.emptyTitle}>No organizations registered</Text>
            <Text style={s.emptySub}>Add a firm using the input field above to begin managing tokens.</Text>
          </View>
        ) : (
          <View style={s.listWrap}>
            <View style={s.tableHeaderRow}>
              <Text style={[s.thText, { flex: 2 }]}>FIRM NAME</Text>
              <Text style={[s.thText, { flex: 1 }]}>ORGANIZATION ID</Text>
              <Text style={[s.thText, { flex: 1.5 }]}>DATE CREATED</Text>
              <Text style={[s.thText, { flex: 2, textAlign: 'right' }]}>ACTIONS</Text>
            </View>

            {firms.map((firm) => (
              <View key={firm.id} style={s.firmRow}>
                <View style={{ flex: 2 }}>
                  <Text style={s.firmName}>{firm.name}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.firmId}>ORG-{firm.id}</Text>
                </View>
                <View style={{ flex: 1.5 }}>
                  <Text style={s.firmDate}>{fmtDate(firm.created_at)}</Text>
                </View>
                <View style={s.actionCol}>
                  <TouchableOpacity style={s.btnIssue} onPress={() => onNavigateToGenerate(firm.id)} activeOpacity={0.8}>
                    <Text style={s.btnIssueText}>Issue Token</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.btnDelete} onPress={() => handleDeleteFirm(firm)} activeOpacity={0.8}>
                    <Text style={s.btnDeleteText}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        )}
      </View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  container: { width: '100%' },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 24,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#0f172a',
    shadowOpacity: 0.03,
    shadowRadius: 8,
    elevation: 1,
  },
  headerBlock: { marginBottom: 20 },
  pageTitle: { fontSize: 18, fontWeight: '700', color: '#0f172a', letterSpacing: -0.2 },
  pageSub: { fontSize: 13, color: '#64748b', marginTop: 3 },

  addFormRow: { flexDirection: 'row', gap: 10, marginBottom: 24 },
  input: {
    flex: 1,
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 14,
    color: '#0f172a',
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  btnPrimary: {
    backgroundColor: '#0f172a',
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 11,
    justify: 'center',
    alignItems: 'center',
  },
  btnPrimaryText: { color: '#ffffff', fontWeight: '600', fontSize: 13 },
  btnDisabled: { opacity: 0.6 },

  listWrap: { borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  tableHeaderRow: {
    flexDirection: 'row',
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#f8fafc',
    borderRadius: 6,
    marginBottom: 6,
  },
  thText: { fontSize: 11, fontWeight: '700', color: '#64748b', letterSpacing: 0.5 },

  firmRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  firmName: { fontSize: 14, fontWeight: '600', color: '#0f172a' },
  firmId: { fontSize: 12, fontWeight: '600', color: '#64748b', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  firmDate: { fontSize: 13, color: '#64748b' },

  actionCol: { flex: 2, flexDirection: 'row', gap: 8, justifyContent: 'flex-end' },
  btnIssue: { backgroundColor: '#eff6ff', borderWidth: 1, borderColor: '#bfdbfe', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 6 },
  btnIssueText: { color: '#1d4ed8', fontWeight: '600', fontSize: 12 },
  btnDelete: { backgroundColor: '#fff1f2', borderWidth: 1, borderColor: '#fecdd3', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 6 },
  btnDeleteText: { color: '#e11d48', fontWeight: '600', fontSize: 12 },

  emptyBox: { paddingVertical: 40, alignItems: 'center' },
  emptyTitle: { fontSize: 14, fontWeight: '600', color: '#475569' },
  emptySub: { fontSize: 13, color: '#94a3b8', marginTop: 4, textAlign: 'center' },
});
