import { selectBrowserPages, pagesFromTask, pageForChangedFile, isLoginRedirect } from '../../../src/core/vv/browser-page-scope';
import { isIgnorableConsoleError } from '../../../src/core/vv/browser-assertions';

describe('browser page scope', () => {
  const discovered = ['/', '/answers', '/login', '/questions', '/saved'];

  it('scopes a home-page task to / instead of crawling every route', () => {
    const task = 'In app/page.tsx set the home-page footer exact visible text to Sandbox VnV repair marker and add data-testid=sandbox-vv-footer. The home page must not throw an uncaught runtime error.';
    expect(pagesFromTask(task)).toEqual(['/']);
    expect(selectBrowserPages(discovered, ['app/layout.tsx', 'app/CrashBeacon.tsx'], task)).toEqual(['/']);
  });

  it('does not treat layout or CrashBeacon as a reason to visit every page', () => {
    expect(pageForChangedFile('app/layout.tsx')).toBeUndefined();
    expect(pageForChangedFile('app/CrashBeacon.tsx')).toBeUndefined();
    expect(selectBrowserPages(discovered, ['app/layout.tsx', 'app/CrashBeacon.tsx'])).toEqual(['/']);
  });

  it('maps a page-specific changed file to that route', () => {
    expect(pageForChangedFile('app/answers/page.tsx')).toBe('/answers');
    expect(selectBrowserPages(discovered, ['app/answers/page.tsx'])).toEqual(['/answers']);
  });

  it('detects middleware login redirects away from the requested page', () => {
    expect(isLoginRedirect('http://127.0.0.1:3010/login', '/')).toBe(true);
    expect(isLoginRedirect('http://127.0.0.1:3010/login/', '/')).toBe(true);
    expect(isLoginRedirect('http://127.0.0.1:3010/', '/')).toBe(false);
    expect(isLoginRedirect('http://127.0.0.1:3010/login', '/login')).toBe(false);
  });
});

describe('ignorable console errors', () => {
  it('ignores browser-native 4xx resource logs but not application throws', () => {
    expect(isIgnorableConsoleError('Failed to load resource: the server responded with a status of 404 (Not Found)')).toBe(true);
    expect(isIgnorableConsoleError('Error: controlled VnV crash beacon')).toBe(false);
  });
});
