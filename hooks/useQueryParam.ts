import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Persists a single piece of UI state (active sub-tab, dropdown filter,
 * pagination page, selected record id, etc.) in the URL's query string via
 * react-router's useSearchParams, so it survives a refresh and is shareable.
 * Always writes with { replace: true } so switching tabs/filters doesn't
 * spam the browser back-button history.
 */
export function useQueryParam<T extends string>(key: string, defaultValue: T): [T, (value: T) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const value = (searchParams.get(key) as T) || defaultValue;

  const setValue = useCallback((next: T) => {
    setSearchParams(prev => {
      const params = new URLSearchParams(prev);
      if (next && next !== defaultValue) {
        params.set(key, next);
      } else {
        params.delete(key);
      }
      return params;
    }, { replace: true });
  }, [key, defaultValue, setSearchParams]);

  return [value, setValue];
}

/**
 * Same purpose, but for hot-path state that changes on every keystroke/frame
 * (free-text search boxes, drag-sliders). Keeps a local React state for
 * immediate UI feedback and mirrors it to the URL via a raw
 * history.replaceState() call, bypassing react-router's navigation
 * machinery entirely so typing doesn't re-render the route tree or touch
 * the history stack.
 */
export function useQueryParamFast(key: string, defaultValue: string): [string, (value: string) => void] {
  const [value, setValue] = useState(
    () => new URLSearchParams(window.location.search).get(key) || defaultValue
  );

  const setAndSync = useCallback((next: string) => {
    setValue(next);
    const params = new URLSearchParams(window.location.search);
    if (next && next !== defaultValue) {
      params.set(key, next);
    } else {
      params.delete(key);
    }
    const query = params.toString();
    const newUrl = `${window.location.pathname}${query ? '?' + query : ''}${window.location.hash}`;
    window.history.replaceState(null, '', newUrl);
  }, [key, defaultValue]);

  return [value, setAndSync];
}
