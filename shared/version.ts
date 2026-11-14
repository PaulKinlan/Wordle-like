// The build's commit and time, filled in by Vite (vite.config.ts). Tests
// and other tools that don't run through Vite see "dev".
declare const __APP_COMMIT__: string | undefined;
declare const __APP_BUILT__: string | undefined;

export const REPO_URL = 'https://github.com/PaulKinlan/Wordle-like';
export const COMMIT: string = typeof __APP_COMMIT__ === 'string' ? __APP_COMMIT__ : 'dev';
export const BUILT: string = typeof __APP_BUILT__ === 'string' ? __APP_BUILT__ : '';
export const SHORT_COMMIT = COMMIT === 'dev' ? 'dev' : COMMIT.slice(0, 7);
export const COMMIT_URL = COMMIT === 'dev' ? REPO_URL : `${REPO_URL}/commit/${COMMIT}`;
