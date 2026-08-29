import type { ImgHTMLAttributes } from 'react';

type BrandImgProps = ImgHTMLAttributes<HTMLImageElement> & { alt: string };

/**
 * Renders a Rivus brand SVG asset. SVGs are vector and already optimized, so
 * a plain `<img>` is the right tool. Centralized so every logo/mark renders
 * consistently.
 */
export function BrandImg({ alt, ...rest }: BrandImgProps) {
	return <img alt={alt} {...rest} />;
}
