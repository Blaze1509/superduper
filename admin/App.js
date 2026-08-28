import React, { useState, useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import LoginScreen from './src/screens/LoginScreen';
import DashboardScreen from './src/screens/DashboardScreen';
import { setAuthHeader, buildBasicAuth } from './src/api/admin';

export default function App() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem('admin_auth_header').then(val => {
      if (val) {
        setAuthHeader(val);
        setLoggedIn(true);
      } else {
        // Fallback check for legacy admin_logged_in flag
        AsyncStorage.getItem('admin_logged_in').then(flag => {
          if (flag === '1') {
            const defaultHeader = buildBasicAuth('blaze', 'Blaze@1509');
            setAuthHeader(defaultHeader);
            setLoggedIn(true);
          }
        });
      }
      setChecking(false);
    });
  }, []);

  const handleLogout = async () => {
    await AsyncStorage.multiRemove(['admin_logged_in', 'admin_auth_header']);
    setAuthHeader('');
    setLoggedIn(false);
  };

  if (checking) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f8fafc' }}>
        <ActivityIndicator size="large" color="#4f46e5" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      {loggedIn
        ? <DashboardScreen onLogout={handleLogout} />
        : <LoginScreen onLogin={() => setLoggedIn(true)} />
      }
    </SafeAreaProvider>
  );
}
