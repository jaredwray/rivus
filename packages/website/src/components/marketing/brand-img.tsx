import type { ImgHTMLAttributes } from 'react';

type BrandImgProps = ImgHTMLAttributes<HTMLImageElement> & { alt: string };

/**
 * Renders a Rivus brand SVG asset. SVGs are vector and already optimized, so
 * `next/image` offers no benefit (it can't optimize SVGs without `unoptimized`)
 * — a plain `<img>` is the right tool. Centralized so the one lint suppression
 * lives in a single place and every logo/mark renders consistently.
 */
export function BrandImg({ alt, ...rest }: BrandImgProps) {
	// biome-ignore lint/performance/noImgElement: vector brand asset; next/image cannot optimize SVG.
	return <img alt={alt} {...rest} />;
}
