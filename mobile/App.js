import React, { useEffect, useState } from 'react';
import { Text, View, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { restore, api, onSessionExpired } from './src/api';
import { C } from './src/ui';
import { LoginScreen, HomeScreen, SearchScreen, CasesScreen, CaseScreen, ScanScreen, ClientScreen, VouchersScreen, AgendaScreen, MoreScreen } from './src/screens';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();
const theme = { ...DefaultTheme, colors: { ...DefaultTheme.colors, primary: C.brand, background: C.bg, card: '#fff', text: C.ink, border: C.line } };
const header = { headerTintColor: C.brandDark, headerTitleStyle: { fontWeight: '700' }, headerStyle: { backgroundColor: '#fff' }, headerShadowVisible: false };
const icon = ch => ({ color }) => <Text style={{ fontSize: 18, color }}>{ch}</Text>;

function Tabs({ user, onLogout }) {
  const cobros = ['admin', 'cobros'].includes(user.role);
  return (
    <Tab.Navigator screenOptions={{ ...header, tabBarActiveTintColor: C.brand, tabBarInactiveTintColor: '#9A8F84', tabBarLabelStyle: { fontSize: 11, fontWeight: '600' } }}>
      <Tab.Screen name="Inicio" options={{ tabBarIcon: icon('⌂'), title: 'LegalTax' }}>{p => <HomeScreen {...p} user={user} />}</Tab.Screen>
      <Tab.Screen name="Expedientes" component={CasesScreen} options={{ tabBarIcon: icon('▤') }} />
      <Tab.Screen name="Buscar" component={SearchScreen} options={{ tabBarIcon: icon('⌕') }} />
      {cobros ? <Tab.Screen name="Vouchers" component={VouchersScreen} options={{ tabBarIcon: icon('$'), title: 'Vouchers por validar', tabBarLabel: 'Vouchers' }} /> : null}
      <Tab.Screen name="Agenda" component={AgendaScreen} options={{ tabBarIcon: icon('◷') }} />
      <Tab.Screen name="Más" options={{ tabBarIcon: icon('☰') }}>{p => <MoreScreen {...p} user={user} onLogout={onLogout} />}</Tab.Screen>
    </Tab.Navigator>
  );
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState(null);
  useEffect(() => {
    onSessionExpired(() => setUser(null));
    (async () => {
      const r = await restore();
      if (r.token) { try { setUser((await api.get('/api/me')).user); } catch (_) { setUser(null); } }
      setReady(true);
    })();
  }, []);
  if (!ready) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' }}><ActivityIndicator color={C.brand} /></View>;
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <NavigationContainer theme={theme}>
        {!user ? <LoginScreen onLogged={setUser} /> : (
          <Stack.Navigator screenOptions={header}>
            <Stack.Screen name="Tabs" options={{ headerShown: false }}>{p => <Tabs {...p} user={user} onLogout={() => setUser(null)} />}</Stack.Screen>
            <Stack.Screen name="Expediente">{p => <CaseScreen {...p} user={user} />}</Stack.Screen>
            <Stack.Screen name="Escanear" component={ScanScreen} options={{ title: 'Escanear documentos' }} />
            <Stack.Screen name="Cliente" component={ClientScreen} />
          </Stack.Navigator>
        )}
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
