/// <reference types="astro/client" />

interface ImportMetaEnv {
	readonly PUBLIC_API_URL?: string;
	readonly PUBLIC_APP_URL?: string;
	readonly PUBLIC_DOCS_URL?: string;
	readonly RIVUS_ENV?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
