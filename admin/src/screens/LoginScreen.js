import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert, KeyboardAvoidingView, Platform
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { checkCredentials } from '../api/admin';

export default function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleLogin = async () => {
    const u = username.trim();
    const p = password.trim();
    if (!u || !p) {
      setErrorMsg('Please enter username and password');
      return;
    }
    setLoading(true);
    setErrorMsg('');
    try {
      const authHeader = await checkCredentials(u, p);
      await AsyncStorage.setItem('admin_auth_header', authHeader);
      await AsyncStorage.setItem('admin_logged_in', '1');
      setLoading(false);
      onLogin();
    } catch (err) {
      setLoading(false);
      const msg = err.response?.data?.error || err.message || 'Invalid credentials';
      setErrorMsg(msg);
      if (Platform.OS !== 'web') {
        Alert.alert('Login Failed', msg);
      }
    }
  };

  return (
    <KeyboardAvoidingView style={s.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={s.card}>
        <View style={s.logoWrap}>
          <View style={s.logoBox}>
            <Text style={s.logoText}>B</Text>
          </View>
        </View>
        <Text style={s.title}>BLAZE ADMIN</Text>
        <Text style={s.subtitle}>Sign in to manage organizations & activation keys</Text>
        
        <View style={s.formGroup}>
          <Text style={s.label}>Username</Text>
          <TextInput
            style={s.input}
            placeholder="Enter username"
            placeholderTextColor="#94a3b8"
            value={username}
            onChangeText={(v) => { setUsername(v); setErrorMsg(''); }}
            autoCapitalize="none"
            autoCorrect={false}
            onSubmitEditing={handleLogin}
          />
        </View>

        <View style={s.formGroup}>
          <Text style={s.label}>Password</Text>
          <TextInput
            style={s.input}
            placeholder="Enter password"
            placeholderTextColor="#94a3b8"
            value={password}
            onChangeText={(v) => { setPassword(v); setErrorMsg(''); }}
            secureTextEntry
            onSubmitEditing={handleLogin}
          />
        </View>

        {!!errorMsg && <Text style={s.errorText}>{errorMsg}</Text>}

        <TouchableOpacity style={[s.btn, loading && s.btnDisabled]} onPress={handleLogin} disabled={loading} activeOpacity={0.85}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Sign In to Portal</Text>}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc', justifyContent: 'center', alignItems: 'center', padding: 24 },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 36,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#0f172a',
    shadowOpacity: 0.05,
    shadowRadius: 16,
    elevation: 2,
  },
  logoWrap: { alignItems: 'center', marginBottom: 12 },
  logoBox: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#4f46e5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: { color: '#ffffff', fontWeight: '900', fontSize: 24 },
  title: { fontSize: 18, fontWeight: '900', color: '#0f172a', textAlign: 'center', letterSpacing: 1.5, marginBottom: 4 },
  subtitle: { fontSize: 13, color: '#64748b', textAlign: 'center', marginBottom: 28 },
  formGroup: { marginBottom: 16 },
  label: { fontSize: 12, fontWeight: '700', color: '#334155', letterSpacing: 0.3, marginBottom: 6 },
  input: { backgroundColor: '#f8fafc', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: '#0f172a', borderWidth: 1, borderColor: '#cbd5e1' },
  errorText: { fontSize: 13, color: '#dc2626', textAlign: 'center', marginBottom: 14, fontWeight: '600' },
  btn: { backgroundColor: '#0f172a', borderRadius: 8, paddingVertical: 13, alignItems: 'center', marginTop: 8 },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: '#ffffff', fontSize: 14, fontWeight: '600' },
});
