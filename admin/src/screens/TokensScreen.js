import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, Modal, Animated, Platform, Clipboard, Alert
} from 'react-native';
import { revokeToken, revertToken, deleteToken, resetTokenPin, resetPanic } from '../api/admin';

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
  if (isNaN(date.getTime())) return '—';
  const YYYY = date.getFullYear();
  const MM = String(date.getMonth() + 1).padStart(2, '0');
  const DD = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${YYYY}-${MM}-${DD} ${hh}:${mm}:${ss}`;
}

function isExpired(d) {
  return new Date(d) < new Date();
}

function getTimeLeft(expiresAt) {
  const diff = new Date(expiresAt) - new Date();
  if (diff <= 0) return null;
  const totalSecs = Math.floor(diff / 1000);

  const yrs = Math.floor(totalSecs / (365 * 86400));
  let remSecs = totalSecs % (365 * 86400);

  const mos = Math.floor(remSecs / (30 * 86400));
  remSecs = remSecs % (30 * 86400);

  const days = Math.floor(remSecs / 86400);
  remSecs = remSecs % 86400;

  const hrs = Math.floor(remSecs / 3600);
  remSecs = remSecs % 3600;

  const mins = Math.floor(remSecs / 60);
  const secs = remSecs % 60;

  const parts = [];
  if (yrs > 0) parts.push(`${yrs}y`);
  if (mos > 0) parts.push(`${mos}mo`);
  if (days > 0) parts.push(`${days}d`);
  parts.push(`${String(hrs).padStart(2, '0')}h`);
  parts.push(`${String(mins).padStart(2, '0')}m`);
  parts.push(`${String(secs).padStart(2, '0')}s`);

  return parts.join(' ');
}

function Countdown({ expiresAt }) {
  const [label, setLabel] = useState(() => getTimeLeft(expiresAt));
  useEffect(() => {
    const t = setInterval(() => {
      const left = getTimeLeft(expiresAt);
      setLabel(left);
      if (!left) clearInterval(t);
    }, 1000);
    return () => clearInterval(t);
  }, [expiresAt]);
  if (!label) return <Text style={s.countdownExpired}>EXPIRED</Text>;
  return <Text style={s.countdown}>⏱ {label}</Text>;
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

export default function TokensScreen({ tokens, onRefresh }) {
  const [tokenSearch, setTokenSearch] = useState('');

  // Enter animation
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(15)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 250, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]).start();
  }, [fadeAnim, slideAnim]);

  // Revert Token Modal State
  const [revertModal, setRevertModal] = useState(false);
  const [tokenToRevert, setTokenToRevert] = useState(null);
  const [revertDuration, setRevertDuration] = useState(DURATIONS[3]);
  const [revertYears, setRevertYears] = useState('');
  const [revertMonths, setRevertMonths] = useState('');
  const [revertDays, setRevertDays] = useState('');
  const [revertHours, setRevertHours] = useState('');
  const [revertMinutes, setRevertMinutes] = useState('');
  const [revertSeconds, setRevertSeconds] = useState('');
  const [reverting, setReverting] = useState(false);

  // Reset PIN Modal State
  const [pinModalVisible, setPinModalVisible] = useState(false);
  const [tokenForPinReset, setTokenForPinReset] = useState(null);
  const [adminNewPin, setAdminNewPin] = useState('');
  const [pinActionLoading, setPinActionLoading] = useState(false);

  const filteredTokens = useMemo(() => {
    if (!tokenSearch.trim()) return tokens;
    const q = tokenSearch.toLowerCase().trim();
    return tokens.filter(t =>
      t.token.toLowerCase().includes(q) ||
      (t.firm_name && t.firm_name.toLowerCase().includes(q)) ||
      (t.username && t.username.toLowerCase().includes(q))
    );
  }, [tokens, tokenSearch]);

  const handleRevokeToken = (t) => {
    const msg = `Revoke authorization for token "${t.token}"?\nThe connected device will be disconnected.`;
    if (Platform.OS === 'web') {
      if (window.confirm(msg)) {
        revokeToken(t.id).then(() => onRefresh());
      }
    } else {
      Alert.alert('Revoke Token', msg, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revoke', style: 'destructive', onPress: async () => {
            try { await revokeToken(t.id); onRefresh(); }
            catch (err) { Alert.alert('Error', err.response?.data?.error || 'Failed to revoke token'); }
          }
        }
      ]);
    }
  };

  const handleDeleteToken = (t) => {
    const msg = `Delete token "${t.token}" from database? This action cannot be undone.`;
    if (Platform.OS === 'web') {
      if (window.confirm(msg)) {
        deleteToken(t.id).then(() => onRefresh());
      }
    } else {
      Alert.alert('Delete Token', msg, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive', onPress: async () => {
            try { await deleteToken(t.id); onRefresh(); }
            catch (err) { Alert.alert('Error', err.response?.data?.error || 'Failed to delete token'); }
          }
        }
      ]);
    }
  };

  const handleResetPanic = async (t) => {
    try {
      await resetPanic(t.id);
      onRefresh();
      if (Platform.OS === 'web') alert(`Panic mode cleared for token ${t.token}`);
      else Alert.alert('Success', `Panic mode cleared for token ${t.token}`);
    } catch (err) {
      const msg = err.response?.data?.error || 'Failed to reset panic mode';
      if (Platform.OS === 'web') alert(msg); else Alert.alert('Error', msg);
    }
  };

  const clearRevertCustom = () => {
    setRevertYears('');
    setRevertMonths('');
    setRevertDays('');
    setRevertHours('');
    setRevertMinutes('');
    setRevertSeconds('');
  };

  const openRevertModal = (t) => {
    setTokenToRevert(t);
    setRevertDuration(DURATIONS[3]);
    clearRevertCustom();
    setRevertModal(true);
  };

  const hasRevertCustomInput = revertYears || revertMonths || revertDays || revertHours || revertMinutes || revertSeconds;

  const handleRevertToken = async () => {
    if (!tokenToRevert) return;
    let payload;
    if (hasRevertCustomInput) {
      payload = {
        years: revertYears || '0',
        months: revertMonths || '0',
        days: revertDays || '0',
        hours: revertHours || '0',
        minutes: revertMinutes || '0',
        seconds: revertSeconds || '0',
      };
    } else if (revertDuration) {
      payload = revertDuration.hours;
    } else {
      const msg = 'Please select a duration or enter custom validity time';
      if (Platform.OS === 'web') alert(msg); else Alert.alert('Error', msg);
      return;
    }

    setReverting(true);
    try {
      await revertToken(tokenToRevert.id, payload);
      setRevertModal(false);
      setTokenToRevert(null);
      onRefresh();
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Failed to restore token';
      if (Platform.OS === 'web') alert(msg);
      else Alert.alert('Error', msg);
    } finally {
      setReverting(false);
    }
  };

  const openPinModal = (t) => {
    setTokenForPinReset(t);
    setAdminNewPin('');
    setPinModalVisible(true);
  };

  const handleAdminSetPin = async () => {
    if (!adminNewPin || adminNewPin.length !== 4 || !/^\d{4}$/.test(adminNewPin)) {
      const msg = 'Please enter a valid 4-digit numeric PIN';
      if (Platform.OS === 'web') alert(msg); else Alert.alert('Error', msg);
      return;
    }
    setPinActionLoading(true);
    try {
      await resetTokenPin(tokenForPinReset.id, adminNewPin, false);
      setPinModalVisible(false);
      setTokenForPinReset(null);
      onRefresh();
      const msg = `PIN updated to "${adminNewPin}" for token ${tokenForPinReset.token}`;
      if (Platform.OS === 'web') alert(msg); else Alert.alert('Success', msg);
    } catch (err) {
      const msg = err.response?.data?.error || 'Failed to reset PIN';
      if (Platform.OS === 'web') alert(msg); else Alert.alert('Error', msg);
    } finally {
      setPinActionLoading(false);
    }
  };

  const handleAdminClearPin = async () => {
    setPinActionLoading(true);
    try {
      await resetTokenPin(tokenForPinReset.id, null, true);
      setPinModalVisible(false);
      setTokenForPinReset(null);
      onRefresh();
      const msg = `App Lock PIN cleared for token ${tokenForPinReset.token}`;
      if (Platform.OS === 'web') alert(msg); else Alert.alert('Success', msg);
    } catch (err) {
      const msg = err.response?.data?.error || 'Failed to clear PIN';
      if (Platform.OS === 'web') alert(msg); else Alert.alert('Error', msg);
    } finally {
      setPinActionLoading(false);
    }
  };

  return (
    <Animated.View style={[s.container, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
      <View style={s.card}>
        <View style={s.headerBlock}>
          <Text style={s.pageTitle}>Token Registry</Text>
          <Text style={s.pageSub}>Monitor issued keys, revocation states, device sessions, and PIN reset overrides.</Text>
        </View>

        {/* Filter Input */}
        <View style={{ marginBottom: 16 }}>
          <TextInput
            style={s.searchInput}
            placeholder="Search by token code, firm name, or username..."
            placeholderTextColor="#94a3b8"
            value={tokenSearch}
            onChangeText={setTokenSearch}
          />
        </View>

        {filteredTokens.length === 0 ? (
          <View style={s.emptyBox}>
            <Text style={s.emptyTitle}>No token records found</Text>
          </View>
        ) : (
          filteredTokens.map((t) => {
            const expired = isExpired(t.expires_at);
            const isRevoked = t.device_id === 'REVOKED' || t.status === 'deactivated';
            const isUsedActive = (t.status === 'in_use' || (t.is_used && !expired)) && !isRevoked;
            const isActive = (t.status === 'active' || (!t.is_used && !expired)) && !isRevoked;

            return (
              <View key={t.id} style={[s.tokenCard, (expired || isRevoked) && s.tokenCardInactive]}>
                {/* Top Row: Token String & Countdown */}
                <View style={s.tokenTopRow}>
                  <TouchableOpacity style={{ flex: 1 }} onPress={() => copyToClipboard(t.token)} activeOpacity={0.7}>
                    <Text style={s.tokenStr}>{t.token}</Text>
                  </TouchableOpacity>

                  {(isActive || isUsedActive) && (
                    <Countdown expiresAt={t.expires_at} />
                  )}
                </View>

                {/* Mid Row: Firm Name, Username & Copy hint */}
                <View style={s.tokenMidRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.tokenFirm}>Organization: {t.firm_name}</Text>
                    {!!t.username && (
                      <Text style={s.tokenUser}>👤 User: {t.username}</Text>
                    )}
                  </View>
                  {isActive && (
                    <TouchableOpacity onPress={() => copyToClipboard(t.token)} activeOpacity={0.7}>
                      <Text style={s.tapCopy}>Copy Code</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {/* Bottom Row: Metadata & Actions */}
                <View style={s.tokenMetaRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.metaText}>Created: {fmtCompactDate(t.created_at)}</Text>
                    <Text style={s.metaText}>
                      Used: {t.used_at ? fmtCompactDate(t.used_at) : (t.is_used ? 'Activated' : 'Not Used Yet')}
                    </Text>
                    {!!t.device_id && (
                      <Text style={s.metaText}>Device ID: {t.device_id === 'REVOKED' ? 'REVOKED' : `${t.device_id.slice(0, 14)}…`}</Text>
                    )}
                  </View>
                  <View style={s.tokenActionCol}>
                    <View style={[
                      s.badge,
                      t.is_panic ? s.badgePanic : isUsedActive ? s.badgeInUse : isActive ? s.badgeActive : isRevoked ? s.badgeRevoked : s.badgeExp
                    ]}>
                      <Text style={s.badgeText}>
                        {t.is_panic ? 'PANIC MODE' : isUsedActive ? 'IN USE' : isActive ? 'ACTIVE' : isRevoked ? 'REVOKED' : 'EXPIRED'}
                      </Text>
                    </View>

                    <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', marginTop: 4 }}>
                      {t.is_panic && (
                        <TouchableOpacity style={s.btnPanicSm} onPress={() => handleResetPanic(t)} activeOpacity={0.8}>
                          <Text style={s.btnPanicSmText}>Unlock Panic</Text>
                        </TouchableOpacity>
                      )}

                      <TouchableOpacity style={s.btnPinResetSm} onPress={() => openPinModal(t)} activeOpacity={0.8}>
                        <Text style={s.btnPinResetSmText}>🔑 Reset PIN</Text>
                      </TouchableOpacity>

                      {(isActive || isUsedActive) ? (
                        <TouchableOpacity style={s.btnRevokeSm} onPress={() => handleRevokeToken(t)} activeOpacity={0.8}>
                          <Text style={s.btnRevokeSmText}>Revoke Access</Text>
                        </TouchableOpacity>
                      ) : (
                        <TouchableOpacity style={s.btnRevertSm} onPress={() => openRevertModal(t)} activeOpacity={0.8}>
                          <Text style={s.btnRevertSmText}>Restore Token</Text>
                        </TouchableOpacity>
                      )}

                      <TouchableOpacity style={s.btnDelSm} onPress={() => handleDeleteToken(t)} activeOpacity={0.8}>
                        <Text style={s.btnDelSmText}>Delete</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              </View>
            );
          })
        )}
      </View>

      {/* Restore Token Duration Modal */}
      <Modal visible={revertModal} animationType="fade" transparent onRequestClose={() => setRevertModal(false)}>
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>Restore Token Access</Text>
            {tokenToRevert && (
              <Text style={s.modalSub}>
                Token: {tokenToRevert.token} ({tokenToRevert.firm_name})
              </Text>
            )}
            <Text style={s.revertNotice}>
              Re-authorize activation key with exact custom validity time.
            </Text>

            <Text style={s.modalLabel}>Select Duration Preset:</Text>
            <View style={s.durationGrid}>
              {DURATIONS.map((d) => (
                <TouchableOpacity
                  key={d.hours}
                  style={[s.durationBtn, revertDuration?.hours === d.hours && !hasRevertCustomInput && s.durationBtnActive]}
                  onPress={() => { setRevertDuration(d); clearRevertCustom(); }}
                  activeOpacity={0.8}
                >
                  <Text style={[s.durationText, revertDuration?.hours === d.hours && !hasRevertCustomInput && s.durationTextActive]}>
                    {d.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={s.modalLabel}>Or Custom Validity (Years / Months / Days / Hours / Minutes / Seconds):</Text>
            <View style={s.matrixGrid}>
              <View style={s.matrixField}>
                <Text style={s.matrixLabel}>Years</Text>
                <TextInput
                  style={s.matrixInput}
                  placeholder="0"
                  placeholderTextColor="#94a3b8"
                  keyboardType="number-pad"
                  value={revertYears}
                  onChangeText={(val) => { setRevertYears(val.replace(/[^0-9]/g, '')); setRevertDuration(null); }}
                />
              </View>

              <View style={s.matrixField}>
                <Text style={s.matrixLabel}>Months</Text>
                <TextInput
                  style={s.matrixInput}
                  placeholder="0"
                  placeholderTextColor="#94a3b8"
                  keyboardType="number-pad"
                  value={revertMonths}
                  onChangeText={(val) => { setRevertMonths(val.replace(/[^0-9]/g, '')); setRevertDuration(null); }}
                />
              </View>

              <View style={s.matrixField}>
                <Text style={s.matrixLabel}>Days</Text>
                <TextInput
                  style={s.matrixInput}
                  placeholder="0"
                  placeholderTextColor="#94a3b8"
                  keyboardType="number-pad"
                  value={revertDays}
                  onChangeText={(val) => { setRevertDays(val.replace(/[^0-9]/g, '')); setRevertDuration(null); }}
                />
              </View>

              <View style={s.matrixField}>
                <Text style={s.matrixLabel}>Hours</Text>
                <TextInput
                  style={s.matrixInput}
                  placeholder="0"
                  placeholderTextColor="#94a3b8"
                  keyboardType="number-pad"
                  value={revertHours}
                  onChangeText={(val) => { setRevertHours(val.replace(/[^0-9]/g, '')); setRevertDuration(null); }}
                />
              </View>

              <View style={s.matrixField}>
                <Text style={s.matrixLabel}>Minutes</Text>
                <TextInput
                  style={s.matrixInput}
                  placeholder="0"
                  placeholderTextColor="#94a3b8"
                  keyboardType="number-pad"
                  value={revertMinutes}
                  onChangeText={(val) => { setRevertMinutes(val.replace(/[^0-9]/g, '')); setRevertDuration(null); }}
                />
              </View>

              <View style={s.matrixField}>
                <Text style={s.matrixLabel}>Seconds</Text>
                <TextInput
                  style={s.matrixInput}
                  placeholder="0"
                  placeholderTextColor="#94a3b8"
                  keyboardType="number-pad"
                  value={revertSeconds}
                  onChangeText={(val) => { setRevertSeconds(val.replace(/[^0-9]/g, '')); setRevertDuration(null); }}
                />
              </View>
            </View>

            <TouchableOpacity
              style={[s.btnRevertLarge, (!revertDuration && !hasRevertCustomInput || reverting) && s.btnDisabled, { marginTop: 20 }]}
              onPress={handleRevertToken}
              disabled={(!revertDuration && !hasRevertCustomInput) || reverting}
              activeOpacity={0.85}
            >
              {reverting ? <ActivityIndicator color="#fff" /> : <Text style={s.btnRevertLargeText}>Restore Authorization</Text>}
            </TouchableOpacity>

            <TouchableOpacity style={s.closeBtn} onPress={() => { setRevertModal(false); setTokenToRevert(null); }}>
              <Text style={s.closeBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Admin Reset PIN Modal */}
      <Modal visible={pinModalVisible} animationType="fade" transparent onRequestClose={() => setPinModalVisible(false)}>
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>🔑 Reset App Lock PIN</Text>
            {tokenForPinReset && (
              <Text style={s.modalSub}>
                Token: {tokenForPinReset.token} ({tokenForPinReset.firm_name})
              </Text>
            )}
            <Text style={s.revertNotice}>
              For privacy, current PIN cannot be viewed. Enter a new 4-digit PIN below to override, or click Clear PIN Lock to remove the lock on that mobile device.
            </Text>

            <Text style={s.modalLabel}>Enter New 4-Digit PIN:</Text>
            <TextInput
              style={s.customHoursInput}
              placeholder="e.g. 1234"
              placeholderTextColor="#94a3b8"
              keyboardType="number-pad"
              maxLength={4}
              value={adminNewPin}
              onChangeText={(val) => setAdminNewPin(val.replace(/[^0-9]/g, ''))}
            />

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
              <TouchableOpacity
                style={[s.btnRevertLarge, { flex: 1 }, (!adminNewPin || adminNewPin.length !== 4 || pinActionLoading) && s.btnDisabled]}
                onPress={handleAdminSetPin}
                disabled={!adminNewPin || adminNewPin.length !== 4 || pinActionLoading}
                activeOpacity={0.85}
              >
                {pinActionLoading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnRevertLargeText}>Set New PIN</Text>}
              </TouchableOpacity>

              <TouchableOpacity
                style={[s.btnClearPin, { flex: 1 }, pinActionLoading && s.btnDisabled]}
                onPress={handleAdminClearPin}
                disabled={pinActionLoading}
                activeOpacity={0.85}
              >
                <Text style={s.btnClearPinText}>Clear PIN Lock</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={s.closeBtn} onPress={() => { setPinModalVisible(false); setTokenForPinReset(null); }}>
              <Text style={s.closeBtnText}>Cancel</Text>
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
  headerBlock: { marginBottom: 20 },
  pageTitle: { fontSize: 18, fontWeight: '700', color: '#0f172a', letterSpacing: -0.2 },
  pageSub: { fontSize: 13, color: '#64748b', marginTop: 3 },

  searchInput: {
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 13,
    color: '#0f172a',
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },

  tokenCard: {
    backgroundColor: '#ffffff',
    borderRadius: 10,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  tokenCardInactive: { backgroundColor: '#f8fafc', borderColor: '#f1f5f9' },
  tokenTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  tokenStr: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
    letterSpacing: 1,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  countdown: { fontSize: 11, fontWeight: '600', color: '#166534', backgroundColor: '#dcfce7', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 },
  countdownExpired: { fontSize: 10, fontWeight: '600', color: '#991b1b', backgroundColor: '#fee2e2', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 },

  tokenMidRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  tokenFirm: { fontSize: 13, color: '#334155', fontWeight: '600' },
  tokenUser: { fontSize: 12, color: '#2563eb', fontWeight: '700', marginTop: 2 },
  tapCopy: { fontSize: 11, color: '#2563eb', fontWeight: '600' },

  tokenMetaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', paddingTop: 8, borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  metaText: { fontSize: 11, color: '#64748b', marginBottom: 2 },
  tokenActionCol: { alignItems: 'flex-end', gap: 6 },

  // Badges
  badge: { borderRadius: 4, paddingHorizontal: 7, paddingVertical: 2 },
  badgeActive: { backgroundColor: '#eff6ff' },
  badgeInUse: { backgroundColor: '#dcfce7' },
  badgeRevoked: { backgroundColor: '#fff1f2' },
  badgeExp: { backgroundColor: '#fef3c7' },
  badgePanic: { backgroundColor: '#fca5a5' },
  badgeText: { fontSize: 10, fontWeight: '700', color: '#334155', letterSpacing: 0.5 },

  btnPanicSm: { backgroundColor: '#fee2e2', borderWidth: 1, borderColor: '#fca5a5', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 5 },
  btnPanicSmText: { color: '#991b1b', fontWeight: '800', fontSize: 11 },

  btnPinResetSm: { backgroundColor: '#e0e7ff', borderWidth: 1, borderColor: '#c7d2fe', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 5 },
  btnPinResetSmText: { color: '#3730a3', fontWeight: '700', fontSize: 11 },

  btnRevokeSm: { backgroundColor: '#fff1f2', borderWidth: 1, borderColor: '#fecdd3', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 5 },
  btnRevokeSmText: { color: '#e11d48', fontWeight: '600', fontSize: 11 },

  btnRevertSm: { backgroundColor: '#eff6ff', borderWidth: 1, borderColor: '#bfdbfe', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 5 },
  btnRevertSmText: { color: '#1d4ed8', fontWeight: '600', fontSize: 11 },

  btnDelSm: { backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 5 },
  btnDelSmText: { color: '#475569', fontWeight: '600', fontSize: 11 },

  btnRevertLarge: { backgroundColor: '#0f172a', borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  btnRevertLargeText: { color: '#ffffff', fontWeight: '600', fontSize: 14 },
  btnClearPin: { backgroundColor: '#fee2e2', borderWidth: 1, borderColor: '#fca5a5', borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  btnClearPinText: { color: '#991b1b', fontWeight: '700', fontSize: 14 },
  btnDisabled: { opacity: 0.5 },

  emptyBox: { paddingVertical: 40, alignItems: 'center' },
  emptyTitle: { fontSize: 14, fontWeight: '600', color: '#64748b' },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.6)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  modalCard: { width: '100%', maxWidth: 500, backgroundColor: '#ffffff', borderRadius: 12, padding: 24, elevation: 5 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#0f172a', marginBottom: 2 },
  modalSub: { fontSize: 13, color: '#2563eb', fontWeight: '600', marginBottom: 12 },
  revertNotice: { fontSize: 12, color: '#64748b', marginBottom: 16, backgroundColor: '#f8fafc', padding: 10, borderRadius: 6 },
  modalLabel: { fontSize: 12, fontWeight: '700', color: '#334155', marginBottom: 8, marginTop: 4 },
  durationGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  durationBtn: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#f8fafc' },
  durationBtnActive: { backgroundColor: '#0f172a', borderColor: '#0f172a' },
  durationText: { fontSize: 12, color: '#475569', fontWeight: '600' },
  durationTextActive: { color: '#ffffff', fontWeight: '600' },
  
  matrixGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  matrixField: { width: 72 },
  matrixLabel: { fontSize: 10, fontWeight: '700', color: '#64748b', marginBottom: 3 },
  matrixInput: {
    backgroundColor: '#f8fafc',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    fontSize: 13,
    color: '#0f172a',
    textAlign: 'center',
  },

  customHoursInput: { backgroundColor: '#f8fafc', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 9, borderWidth: 1, borderColor: '#cbd5e1', fontSize: 14, color: '#0f172a' },
  closeBtn: { backgroundColor: '#f1f5f9', borderRadius: 8, paddingVertical: 11, alignItems: 'center', marginTop: 10 },
  closeBtnText: { color: '#475569', fontWeight: '600', fontSize: 13 },
});
