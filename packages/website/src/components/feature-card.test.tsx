import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FeatureCard } from './feature-card';

describe('FeatureCard', () => {
	it('renders the feature title and description', () => {
		render(<FeatureCard feature={{ title: 'Typed API', description: 'A typed API.' }} />);

		expect(screen.getByRole('heading', { name: 'Typed API' })).toBeTruthy();
		expect(screen.getByText('A typed API.')).toBeTruthy();
	});

	it('gives the card a slugified anchor id', () => {
		const { container } = render(
			<FeatureCard feature={{ title: 'Edge Worker', description: 'x' }} />,
		);

		expect(container.querySelector('#edge-worker')).not.toBeNull();
	});
});
