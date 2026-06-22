import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import {
	brandGradient,
	briefingGradient,
	briefingGradientWide,
	gradientDiagonal,
	gradientVertical,
} from '../theme/tokens';

type GradientProps = {
	children?: ReactNode;
	style?: StyleProp<ViewStyle>;
	vertical?: boolean;
};

// The signature cyan -> purple Rivus gradient (diagonal by default).
export function BrandGradient({ children, style, vertical }: GradientProps) {
	return (
		<LinearGradient
			colors={[...brandGradient]}
			start={vertical ? gradientVertical.start : gradientDiagonal.start}
			end={vertical ? gradientVertical.end : gradientDiagonal.end}
			style={style}
		>
			{children}
		</LinearGradient>
	);
}

// Dark "while you were away" briefing gradient. `wide` uses the home-page stops.
export function BriefingGradient({ children, style, wide }: GradientProps & { wide?: boolean }) {
	return (
		<LinearGradient
			colors={wide ? [...briefingGradientWide] : [...briefingGradient]}
			start={{ x: 0, y: 0 }}
			end={{ x: 1, y: 1 }}
			style={style}
		>
			{children}
		</LinearGradient>
	);
}
