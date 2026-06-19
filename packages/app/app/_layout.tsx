import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

export default function RootLayout() {
	return (
		<SafeAreaProvider>
			<StatusBar style="auto" />
			<Stack
				screenOptions={{
					headerStyle: { backgroundColor: '#0f172a' },
					headerTintColor: '#f8fafc',
					contentStyle: { backgroundColor: '#0f172a' },
				}}
			>
				<Stack.Screen name="index" options={{ title: 'Rivus' }} />
				<Stack.Screen name="items" options={{ title: 'Items' }} />
			</Stack>
		</SafeAreaProvider>
	);
}
