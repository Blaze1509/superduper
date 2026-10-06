import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, Animated, Platform, Clipboard, Alert, Modal, ScrollView
} from 'react-native';
import { generateToken } from '../api/admin';

const DURATIONS = [
  { label: '1 Hour', hours: 1 },
  { label: '6 Hours', hours: 6 },
  { label: '12 Hours', hours: 12 },
  { label: '24 Hours (1 Day)', hours: 24 },
  { label: '3 Days', hours: 72 },
  { label: '7 Days', hours: 168 },
  { label: '30 Days', hours: 720 },
  { label: '1 Year', hours: 8760 },
];

function fmtCompactDate(d) {
  if (!d) return '—';
  const date = new Date(d);
  const YYYY = date.getFullYear();
  const MM = String(date.getMonth() + 1).padStart(2, '0');
  const DD = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${YYYY}-${MM}-${DD} ${hh}:${mm}:${ss}`;
}

function copyToClipboard(text) {
  if (Platform.OS === 'web' && typeof navigator !== 'undefined') {
    navigator.clipboard?.writeText(text);
    alert('Token copied to clipboard');
  } else {
    Clipboard.setString(text);
    Alert.alert('Copied', 'Token copied to clipboard');
  }
}

export default function GenerateTokenScreen({ firms, initialFirmId, onTokenGenerated }) {
  const [selectedFirmId, setSelectedFirmId] = useState(initialFirmId || '');
  const [selectedDuration, setSelectedDuration] = useState(DURATIONS[3]); // Default 24 Hours
  const [username, setUsername] = useState('');

  // Searchable Select Modal state for Organizations
  const [firmModalOpen, setFirmModalOpen] = useState(false);
  const [firmSearchText, setFirmSearchText] = useState('');

  // Custom Granular Duration Inputs
  const [years, setYears] = useState('');
  const [months, setMonths] = useState('');
  const [days, setDays] = useState('');
  const [hours, setHours] = useState('');
  const [minutes, setMinutes] = useState('');
  const [seconds, setSeconds] = useState('');

  const [generating, setGenerating] = useState(false);
  const [resultToken, setResultToken] = useState(null);

  // Enter animation
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(15)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 250, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]).start();
  }, [fadeAnim, slideAnim]);

  const prevInitialRef = useRef(initialFirmId);

  useEffect(() => {
    if (initialFirmId && initialFirmId !== prevInitialRef.current) {
      setSelectedFirmId(String(initialFirmId));
      prevInitialRef.current = initialFirmId;
    } else if (!selectedFirmId) {
      if (initialFirmId) {
        setSelectedFirmId(String(initialFirmId));
      } else if (firms && firms.length > 0) {
        setSelectedFirmId(String(firms[0].id));
      }
    }
  }, [firms, initialFirmId, selectedFirmId]);

  const filteredSelectFirms = useMemo(() => {
    if (!firmSearchText.trim()) return firms || [];
    const q = firmSearchText.toLowerCase().trim();
    return (firms || []).filter(f => f.name.toLowerCase().includes(q));
  }, [firms, firmSearchText]);

  const selectedFirmObj = (firms || []).find(f => String(f.id) === String(selectedFirmId));

  const hasCustomInput = years || months || days || hours || minutes || seconds;

  const handleCustomChange = (setter, val) => {
    setter(val.replace(/[^0-9]/g, ''));
    setSelectedDuration(null);
  };

  const clearCustomInputs = () => {
    setYears('');
    setMonths('');
    setDays('');
    setHours('');
    setMinutes('');
    setSeconds('');
  };

  const handleGenerate = async () => {
    if (!selectedFirmId) {
      const msg = 'Please select an organization';
      if (Platform.OS === 'web') alert(msg); else Alert.alert('Error', msg);
      return;
    }
    if (!username.trim()) {
      const msg = 'Please enter a Username / Identity Label for this token';
      if (Platform.OS === 'web') alert(msg); else Alert.alert('Error', msg);
      return;
    }

    let durationPayload;
    if (hasCustomInput) {
      durationPayload = {
        years: years || '0',
        months: months || '0',
        days: days || '0',
        hours: hours || '0',
        minutes: minutes || '0',
        seconds: seconds || '0',
      };
    } else if (selectedDuration) {
      durationPayload = selectedDuration.hours;
    } else {
      const msg = 'Please select a duration preset or enter custom validity time';
      if (Platform.OS === 'web') alert(msg); else Alert.alert('Error', msg);
      return;
    }

    setGenerating(true);
    setResultToken(null);
    try {
      const res = await generateToken(parseInt(selectedFirmId, 10), durationPayload, username.trim());
      if (res && res.data && res.data.data) {
        setResultToken(res.data.data);
        if (onTokenGenerated) onTokenGenerated();
      }
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Failed to generate token';
      if (Platform.OS === 'web') alert(msg); else Alert.alert('Error', msg);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Animated.View style={[s.container, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
      <View style={s.card}>
        <View style={s.headerBlock}>
          <Text style={s.pageTitle}>Issue Activation Token</Text>
          <Text style={s.pageSub}>Generate unique activation credentials with exact custom time durations down to seconds.</Text>
        </View>

        {/* Step 1: Searchable Organization Select */}
        <Text style={s.stepTitle}>1. Target Organization (Required * )</Text>
        {(!firms || firms.length === 0) ? (
          <Text style={s.warningText}>No registered organizations available. Please add a firm first.</Text>
        ) : (
          <TouchableOpacity
            style={s.selectTriggerBtn}
            onPress={() => { setFirmSearchText(''); setFirmModalOpen(true); }}
            activeOpacity={0.8}
          >
            <View style={{ flex: 1 }}>
              <Text style={s.selectTriggerSub}>Target Firm</Text>
              <Text style={s.selectTriggerTitle}>
                {selectedFirmObj ? selectedFirmObj.name : 'Select Organization...'}
              </Text>
            </View>
            <Text style={s.selectArrow}>▼</Text>
          </TouchableOpacity>
        )}

        {/* Step 2: Username / Identity Label (Required) */}
        <Text style={[s.stepTitle, { marginTop: 22 }]}>2. Username / Identity Label (Required * )</Text>
        <TextInput
          style={s.usernameInput}
          placeholder="e.g. Ramesh Kumar / Counter Mobile 1 (Required)"
          placeholderTextColor="#94a3b8"
          value={username}
          onChangeText={setUsername}
        />

        {/* Step 3: Duration Presets */}
        <Text style={[s.stepTitle, { marginTop: 22 }]}>3. Quick Duration Presets</Text>
        <View style={s.presetGrid}>
          {DURATIONS.map((p) => {
            const isSel = selectedDuration?.hours === p.hours && !hasCustomInput;
            return (
              <TouchableOpacity
                key={p.hours}
                style={[s.presetBtn, isSel && s.presetBtnSelected]}
                onPress={() => { setSelectedDuration(p); clearCustomInputs(); }}
                activeOpacity={0.8}
              >
                <Text style={[s.presetText, isSel && s.presetTextSelected]}>
                  {p.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Step 4: Granular Custom Duration Matrix */}
        <Text style={[s.stepTitle, { marginTop: 20 }]}>Or Custom Duration (Year / Month / Day / Hour / Minute / Second):</Text>
        <View style={s.matrixGrid}>
          <View style={s.matrixField}>
            <Text style={s.matrixLabel}>Years</Text>
            <TextInput
              style={s.matrixInput}
              placeholder="0"
              placeholderTextColor="#94a3b8"
              keyboardType="number-pad"
              value={years}
              onChangeText={(val) => handleCustomChange(setYears, val)}
            />
          </View>

          <View style={s.matrixField}>
            <Text style={s.matrixLabel}>Months</Text>
            <TextInput
              style={s.matrixInput}
              placeholder="0"
              placeholderTextColor="#94a3b8"
              keyboardType="number-pad"
              value={months}
              onChangeText={(val) => handleCustomChange(setMonths, val)}
            />
          </View>

          <View style={s.matrixField}>
            <Text style={s.matrixLabel}>Days</Text>
            <TextInput
              style={s.matrixInput}
              placeholder="0"
              placeholderTextColor="#94a3b8"
              keyboardType="number-pad"
              value={days}
              onChangeText={(val) => handleCustomChange(setDays, val)}
            />
          </View>

          <View style={s.matrixField}>
            <Text style={s.matrixLabel}>Hours</Text>
            <TextInput
              style={s.matrixInput}
              placeholder="0"
              placeholderTextColor="#94a3b8"
              keyboardType="number-pad"
              value={hours}
              onChangeText={(val) => handleCustomChange(setHours, val)}
            />
          </View>

          <View style={s.matrixField}>
            <Text style={s.matrixLabel}>Minutes</Text>
            <TextInput
              style={s.matrixInput}
              placeholder="0"
              placeholderTextColor="#94a3b8"
              keyboardType="number-pad"
              value={minutes}
              onChangeText={(val) => handleCustomChange(setMinutes, val)}
            />
          </View>

          <View style={s.matrixField}>
            <Text style={s.matrixLabel}>Seconds</Text>
            <TextInput
              style={s.matrixInput}
              placeholder="0"
              placeholderTextColor="#94a3b8"
              keyboardType="number-pad"
              value={seconds}
              onChangeText={(val) => handleCustomChange(setSeconds, val)}
            />
          </View>
        </View>

        {/* Submit */}
        <TouchableOpacity
          style={[s.btnSubmit, (!selectedFirmId || !username.trim() || (!selectedDuration && !hasCustomInput) || generating) && s.btnDisabled]}
          onPress={handleGenerate}
          disabled={!selectedFirmId || !username.trim() || (!selectedDuration && !hasCustomInput) || generating}
          activeOpacity={0.85}
        >
          {generating ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={s.btnSubmitText}>Issue Activation Token</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Generated Result Card */}
      {resultToken && (
        <View style={s.resultCard}>
          <View style={s.resultHeader}>
            <View style={s.resultBadge}>
              <Text style={s.resultBadgeText}>ACTIVATION KEY ISSUED</Text>
            </View>
            <Text style={s.resultFirm}>Firm: {selectedFirmObj ? selectedFirmObj.name : ''}</Text>
            {!!resultToken.username && (
              <Text style={s.resultUser}>User: {resultToken.username}</Text>
            )}
          </View>

          <Text style={s.resultValue}>{resultToken.token}</Text>

          {resultToken.expires_at && (
            <Text style={s.resultExpiry}>
              Valid Until: {fmtCompactDate(resultToken.expires_at)}
            </Text>
          )}

          <TouchableOpacity style={s.copyBtn} onPress={() => copyToClipboard(resultToken.token)} activeOpacity={0.85}>
            <Text style={s.copyBtnText}>Copy Token to Clipboard</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Organization Searchable Select Modal */}
      <Modal visible={firmModalOpen} animationType="fade" transparent onRequestClose={() => setFirmModalOpen(false)}>
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>Select Organization</Text>
            <Text style={s.modalSub}>Search and pick the target organization for this token.</Text>

            <TextInput
              style={s.modalSearchInput}
              placeholder="Type to filter organizations..."
              placeholderTextColor="#94a3b8"
              value={firmSearchText}
              onChangeText={setFirmSearchText}
            />

            <ScrollView style={s.firmListScroll} keyboardShouldPersistTaps="handled">
              {filteredSelectFirms.length === 0 ? (
                <View style={{ paddingVertical: 20, alignItems: 'center' }}>
                  <Text style={{ color: '#94a3b8', fontSize: 13 }}>No matching organizations found</Text>
                </View>
              ) : (
                filteredSelectFirms.map((f) => {
                  const isSel = String(f.id) === String(selectedFirmId);
                  return (
                    <TouchableOpacity
                      key={f.id}
                      style={[s.firmListItem, isSel && s.firmListItemSel]}
                      onPress={() => {
                        setSelectedFirmId(String(f.id));
                        setFirmModalOpen(false);
                      }}
                      activeOpacity={0.7}
                    >
                      <Text style={[s.firmListItemText, isSel && s.firmListItemTextSel]}>
                        {f.name}
                      </Text>
                      {isSel && <Text style={s.firmCheck}>✓ Selected</Text>}
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>

            <TouchableOpacity style={s.closeBtn} onPress={() => setFirmModalOpen(false)}>
              <Text style={s.closeBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
  headerBlock: { marginBottom: 22 },
  pageTitle: { fontSize: 18, fontWeight: '700', color: '#0f172a', letterSpacing: -0.2 },
  pageSub: { fontSize: 13, color: '#64748b', marginTop: 3 },

  stepTitle: { fontSize: 13, fontWeight: '700', color: '#334155', letterSpacing: 0.3, marginBottom: 10 },
  warningText: { color: '#dc2626', fontSize: 13, marginVertical: 6 },

  // Select Trigger Box
  selectTriggerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderWidth: 1.5,
    borderColor: '#2563eb',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  selectTriggerSub: { fontSize: 10, fontWeight: '700', color: '#2563eb', textTransform: 'uppercase', letterSpacing: 0.5 },
  selectTriggerTitle: { fontSize: 15, fontWeight: '700', color: '#0f172a', marginTop: 2 },
  selectArrow: { fontSize: 14, color: '#2563eb', fontWeight: '800', marginLeft: 12 },

  usernameInput: {
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 14,
    color: '#0f172a',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    marginBottom: 6,
  },

  presetGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  presetBtn: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  presetBtnSelected: {
    backgroundColor: '#0f172a',
    borderColor: '#0f172a',
  },
  presetText: { fontSize: 13, fontWeight: '600', color: '#475569' },
  presetTextSelected: { color: '#ffffff', fontWeight: '600' },

  // Granular Matrix
  matrixGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  matrixField: { width: 100 },
  matrixLabel: { fontSize: 11, fontWeight: '700', color: '#64748b', marginBottom: 4 },
  matrixInput: {
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    fontSize: 14,
    color: '#0f172a',
    textAlign: 'center',
  },

  btnSubmit: {
    backgroundColor: '#0f172a',
    borderRadius: 8,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 24,
  },
  btnSubmitText: { color: '#ffffff', fontWeight: '600', fontSize: 14 },
  btnDisabled: { opacity: 0.5 },

  // Result card
  resultCard: {
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#bbf7d0',
    borderRadius: 12,
    padding: 22,
    marginTop: 20,
    alignItems: 'center',
  },
  resultHeader: { alignItems: 'center', marginBottom: 6 },
  resultBadge: { backgroundColor: '#dcfce7', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 4, marginBottom: 6 },
  resultBadgeText: { fontSize: 11, fontWeight: '800', color: '#166534', letterSpacing: 0.5 },
  resultFirm: { fontSize: 13, fontWeight: '600', color: '#334155' },
  resultUser: { fontSize: 12, fontWeight: '700', color: '#2563eb', marginTop: 2 },
  resultValue: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0f172a',
    letterSpacing: 2,
    textAlign: 'center',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginVertical: 10,
  },
  resultExpiry: { fontSize: 12, color: '#64748b', marginTop: 2 },
  copyBtn: {
    backgroundColor: '#166534',
    borderRadius: 6,
    paddingHorizontal: 18,
    paddingVertical: 10,
    marginTop: 14,
  },
  copyBtnText: { color: '#ffffff', fontWeight: '600', fontSize: 13 },

  // Modal styling for Searchable Select
  modalOverlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.6)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  modalCard: { width: '100%', maxWidth: 480, maxHeight: '80%', backgroundColor: '#ffffff', borderRadius: 12, padding: 24, elevation: 5 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#0f172a', marginBottom: 2 },
  modalSub: { fontSize: 13, color: '#64748b', marginBottom: 16 },
  modalSearchInput: {
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: '#0f172a',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    marginBottom: 12,
  },
  firmListScroll: { maxHeight: 280, marginVertical: 4 },
  firmListItem: {
    flexDirection: 'row',
    justify: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 8,
    backgroundColor: '#ffffff',
  },
  firmListItemSel: {
    backgroundColor: '#eff6ff',
    borderColor: '#2563eb',
  },
  firmListItemText: { fontSize: 14, fontWeight: '600', color: '#334155' },
  firmListItemTextSel: { color: '#1d4ed8', fontWeight: '700' },
  firmCheck: { fontSize: 12, fontWeight: '800', color: '#2563eb' },

  closeBtn: { backgroundColor: '#f1f5f9', borderRadius: 8, paddingVertical: 11, alignItems: 'center', marginTop: 12 },
  closeBtnText: { color: '#475569', fontWeight: '600', fontSize: 13 },
});
