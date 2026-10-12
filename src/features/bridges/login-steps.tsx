import { Check, Copy, Cookie, ExternalLink, LoaderCircle } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { t } from '@/i18n';
import { cookieLogin, openExternal } from '@/lib/native';
import { isTauri } from '@/lib/platform';
import { cn } from '@/lib/utils';
import type { CookieField, CookieFieldSource, CookiesParams, DisplayAndWaitParams, InputField, UserInputParams } from './types';

/** Bridge-provided instructions; plain text with preserved line breaks. */
export function Instructions({ text, className }: { text?: string; className?: string }) {
  if (!text?.trim()) return null;
  return <p className={cn('text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground', className)}>{text.trim()}</p>;
}

/** Go's regexp.MatchString is unanchored; mirror that. Invalid (Go-only) patterns are skipped. */
function matchesPattern(pattern: string | undefined, value: string): boolean {
  if (!pattern) return true;
  try {
    return new RegExp(pattern).test(value);
  } catch {
    return true;
  }
}

// ── user_input ──────────────────────────────────────────────────────────────

function fieldPlaceholder(type: InputField['type']): string | undefined {
  switch (type) {
    case 'phone_number':
      return t('bridges.phonePlaceholder');
    case 'email':
      return t('bridges.emailPlaceholder');
    case 'url':
      return 'https://';
    case '2fa_code':
      return '123456';
    default:
      return undefined;
  }
}

function inputType(field: InputField): string {
  switch (field.type) {
    case 'password':
      return 'password';
    case 'email':
      return 'email';
    case 'phone_number':
      return 'tel';
    case 'url':
      return 'url';
    default:
      return 'text';
  }
}

export function UserInputStep({
  params,
  instructions,
  busy,
  onSubmit,
  onBack,
}: {
  params: UserInputParams;
  instructions?: string;
  busy: boolean;
  onSubmit: (values: Record<string, string>) => void;
  onBack?: () => void;
}) {
  const fields = params.fields ?? [];
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.id, f.default_value ?? ''])),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    const out: Record<string, string> = {};
    for (const field of fields) {
      const value = (values[field.id] ?? '').trim();
      if (!value) next[field.id] = t('bridges.fieldRequired');
      else if (field.type === 'phone_number' && !/^\+[\d\s\-().]+$/.test(value))
        next[field.id] = t('bridges.phoneFormat', { example: t('bridges.phonePlaceholder') });
      else if (field.type === 'email' && !value.includes('@')) next[field.id] = t('bridges.invalidEmail');
      else if (field.min_length && value.length < field.min_length)
        next[field.id] = t('bridges.minLength', { count: field.min_length });
      else if (field.max_length && value.length > field.max_length)
        next[field.id] = t('bridges.maxLength', { count: field.max_length });
      else if (field.type !== 'phone_number' && !matchesPattern(field.pattern, value))
        next[field.id] = t('bridges.invalidFormat');
      // Passwords keep their exact whitespace.
      out[field.id] = field.type === 'password' ? (values[field.id] ?? '') : value;
    }
    setErrors(next);
    if (Object.keys(next).length === 0) onSubmit(out);
  };

  const images = (params.attachments ?? []).filter((a) => a?.content && a.info?.mimetype?.startsWith('image/'));

  return (
    <form onSubmit={submit} className="grid gap-4">
      <Instructions text={instructions} />
      {images.map((a, i) => (
        <img
          key={i}
          src={`data:${a.info!.mimetype};base64,${a.content}`}
          alt={a.filename ?? ''}
          className="mx-auto max-h-48 rounded-md border bg-white"
        />
      ))}
      {fields.map((field, i) => (
        <div key={field.id} className="grid gap-1.5">
          <Label htmlFor={`login-${field.id}`}>{field.name || field.id}</Label>
          {field.description && <p className="-mt-0.5 text-xs text-muted-foreground">{field.description}</p>}
          {field.type === 'select' && field.options?.length ? (
            <Select
              value={values[field.id] || undefined}
              onValueChange={(v) => setValues((s) => ({ ...s, [field.id]: v }))}
            >
              <SelectTrigger id={`login-${field.id}`} className="w-full" aria-invalid={!!errors[field.id]}>
                <SelectValue placeholder={t('bridges.selectPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {field.options.filter(Boolean).map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              id={`login-${field.id}`}
              type={inputType(field)}
              autoFocus={i === 0}
              autoComplete={field.type === '2fa_code' ? 'one-time-code' : field.type === 'password' ? 'current-password' : 'off'}
              inputMode={field.type === '2fa_code' ? 'numeric' : undefined}
              spellCheck={false}
              placeholder={fieldPlaceholder(field.type)}
              value={values[field.id] ?? ''}
              aria-invalid={!!errors[field.id]}
              onChange={(e) => setValues((s) => ({ ...s, [field.id]: e.target.value }))}
              className={cn(field.type === '2fa_code' && 'font-mono tracking-widest')}
            />
          )}
          {errors[field.id] && <p className="text-xs text-destructive">{errors[field.id]}</p>}
        </div>
      ))}
      <div className="flex justify-end gap-2 pt-1">
        {onBack && (
          <Button type="button" variant="ghost" onClick={onBack} disabled={busy}>
            {t('common.back')}
          </Button>
        )}
        <Button type="submit" disabled={busy}>
          {busy && <LoaderCircle className="animate-spin" />}
          {t('common.next')}
        </Button>
      </div>
    </form>
  );
}

// ── display_and_wait ────────────────────────────────────────────────────────

export function DisplayAndWaitStep({
  params,
  instructions,
  onBack,
}: {
  params: DisplayAndWaitParams;
  instructions?: string;
  onBack?: () => void;
}) {
  return (
    <div className="grid gap-5">
      <Instructions text={instructions} />
      <div className="flex justify-center">
        {params.type === 'qr' && params.data && (
          <div className="rounded-lg bg-white p-4 ring-1 ring-border">
            <QRCodeSVG value={params.data} size={240} bgColor="#ffffff" fgColor="#000000" level="L" />
          </div>
        )}
        {params.type === 'emoji' &&
          (params.image_url ? (
            <img src={params.image_url} alt={params.data ?? ''} className="size-32" />
          ) : (
            <span className="text-7xl leading-none">{params.data}</span>
          ))}
        {params.type === 'code' && params.data && <CodeDisplay code={params.data} />}
        {params.type === 'nothing' && <LoaderCircle className="size-8 animate-spin text-muted-foreground" />}
      </div>
      <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <LoaderCircle className="size-3.5 animate-spin" />
        {t('bridges.waitingForConfirmation')}
      </div>
      {onBack && (
        <div className="flex justify-end">
          <Button variant="ghost" onClick={onBack}>
            {t('common.back')}
          </Button>
        </div>
      )}
    </div>
  );
}

function CodeDisplay({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be denied; the code stays selectable.
    }
  };
  return (
    <div className="flex items-center gap-3">
      <span className="rounded-md bg-muted px-4 py-2 font-mono text-3xl tracking-[0.2em] select-all">{code}</span>
      <Button variant="outline" size="icon" onClick={copy} aria-label={t('bridges.copyCode')}>
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
  );
}

// ── cookies ─────────────────────────────────────────────────────────────────

function cookieSource(field: CookieField): CookieFieldSource | undefined {
  return field.sources?.find((s) => s.type === 'cookie');
}

function sourceHint(source: CookieFieldSource | undefined): string {
  if (!source) return t('bridges.hintNoSource');
  const { name } = source;
  const url = source.request_url_regex;
  switch (source.type) {
    case 'cookie':
      return source.cookie_domain
        ? t('bridges.hintCookieWithDomain', { name, domain: source.cookie_domain })
        : t('bridges.hintCookie', { name });
    case 'local_storage':
      return t('bridges.hintLocalStorage', { name });
    case 'request_header':
      return url ? t('bridges.hintHeaderWithUrl', { name, url }) : t('bridges.hintHeader', { name });
    case 'request_body':
      return url ? t('bridges.hintBodyWithUrl', { name, url }) : t('bridges.hintBody', { name });
    default:
      return t('bridges.hintSpecial', { name });
  }
}

/** Maps the machine codes returned by the native `open_cookie_login` command to a message. */
function cookieLoginError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw === 'login_window_open') return t('bridges.cookieErrWindowOpen');
  if (raw === 'invalid_login_url') return t('bridges.cookieErrInvalidUrl');
  if (raw === 'no_cookies') return t('bridges.cookieErrNoCookies');
  const failed = /^login_window_failed: ?(.*)$/s.exec(raw);
  if (failed) return t('bridges.cookieErrWindowFailed', { error: failed[1] });
  return raw;
}

/** Parses a pasted `Cookie:` header (`a=1; b=2`) into a map. */
function parseCookieHeader(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of text.replace(/^\s*cookie:\s*/i, '').split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return out;
}

export function CookiesStep({
  params,
  instructions,
  networkName,
  busy,
  onSubmit,
}: {
  params: CookiesParams;
  instructions?: string;
  networkName: string;
  busy: boolean;
  onSubmit: (values: Record<string, string>) => void;
}) {
  const fields = useMemo(() => params.fields ?? [], [params.fields]);
  // The native webview can only read cookies; every required field must come from one.
  const canNative = fields.length > 0 && fields.every((f) => !f.required || !!cookieSource(f));
  const [nativeState, setNativeState] = useState<'idle' | 'open' | 'closed' | 'missing'>('idle');
  const [manualOpen, setManualOpen] = useState(!canNative || !isTauri || !!params.extract_js);
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [header, setHeader] = useState('');
  const [nativeError, setNativeError] = useState<string | null>(null);
  const autoStarted = useRef(false);

  const runNative = async () => {
    setNativeState('open');
    setNativeError(null);
    const wanted = new Map<string, { name: string; domain?: string }>();
    for (const field of fields) {
      const src = cookieSource(field);
      if (src) wanted.set(`${src.name}|${src.cookie_domain ?? ''}`, { name: src.name, domain: src.cookie_domain || undefined });
    }
    let result: Record<string, string> | null = null;
    try {
      result = await cookieLogin({
        url: params.url,
        userAgent: params.user_agent,
        cookies: [...wanted.values()],
        title: t('bridges.loginTitle', { name: networkName }),
      });
    } catch (err) {
      console.error('cookieLogin failed', err);
      setNativeError(cookieLoginError(err));
    }
    if (!result) {
      setNativeState('closed');
      setManualOpen(true);
      return;
    }
    const out: Record<string, string> = {};
    for (const field of fields) {
      const src = cookieSource(field);
      const value = src ? result[src.name] : undefined;
      if (value) out[field.id] = value;
    }
    if (fields.some((f) => f.required && !out[f.id])) {
      setValues(out);
      setNativeState('missing');
      setManualOpen(true);
      return;
    }
    setNativeState('idle');
    onSubmit(out);
  };

  useEffect(() => {
    // Open the login window right away in the desktop app, like Beeper does.
    if (canNative && isTauri && !autoStarted.current) {
      autoStarted.current = true;
      void runNative();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyHeader = (text: string) => {
    setHeader(text);
    const parsed = parseCookieHeader(text);
    setValues((prev) => {
      const next = { ...prev };
      for (const field of fields) {
        const src = cookieSource(field);
        if (src && parsed[src.name]) next[field.id] = parsed[src.name];
      }
      return next;
    });
  };

  const submitManual = (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    const out: Record<string, string> = {};
    for (const field of fields) {
      const value = (values[field.id] ?? '').trim();
      if (!value) {
        if (field.required) next[field.id] = t('bridges.valueRequired');
        continue;
      }
      if (!matchesPattern(field.pattern, value)) next[field.id] = t('bridges.invalidFormat');
      out[field.id] = value;
    }
    setErrors(next);
    if (Object.keys(next).length === 0) onSubmit(out);
  };

  const hasCookieFields = fields.some((f) => !!cookieSource(f));

  return (
    <div className="grid gap-4">
      <Instructions text={instructions} />

      {canNative && isTauri && (
        <div className="flex flex-col items-center gap-2 py-2 text-center">
          {nativeState === 'open' ? (
            <>
              <LoaderCircle className="size-6 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">{t('bridges.nativeOpen')}</p>
            </>
          ) : (
            <>
              {nativeState === 'closed' &&
                (nativeError ? (
                  <p className="text-sm text-destructive">{nativeError}</p>
                ) : (
                  <p className="text-sm text-muted-foreground">{t('bridges.nativeClosed')}</p>
                ))}
              {nativeState === 'missing' && (
                <p className="text-sm text-muted-foreground">{t('bridges.nativeMissing')}</p>
              )}
              <Button onClick={runNative} disabled={busy}>
                {busy ? <LoaderCircle className="animate-spin" /> : <Cookie />}
                {t('bridges.openLoginWindow')}
              </Button>
            </>
          )}
        </div>
      )}

      {params.extract_js && (
        <p className="text-xs text-muted-foreground">
          {t('bridges.extractJsUnsupported')}
        </p>
      )}

      <Collapsible open={manualOpen} onOpenChange={setManualOpen}>
        {canNative && isTauri && (
          <CollapsibleTrigger asChild>
            <button className="text-xs text-muted-foreground underline-offset-4 hover:underline">
              {manualOpen ? t('bridges.hideManual') : t('bridges.showManual')}
            </button>
          </CollapsibleTrigger>
        )}
        <CollapsibleContent>
          <form onSubmit={submitManual} className="mt-3 grid gap-4">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-muted-foreground">{t('bridges.manualIntro')}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => void openExternal(params.url)}>
                <ExternalLink />
                {t('bridges.openInBrowser')}
              </Button>
            </div>
            {hasCookieFields && (
              <div className="grid gap-1.5">
                <Label htmlFor="login-cookie-header">{t('bridges.cookieHeaderLabel')}</Label>
                <Textarea
                  id="login-cookie-header"
                  value={header}
                  onChange={(e) => applyHeader(e.target.value)}
                  placeholder={t('bridges.cookieHeaderPlaceholder')}
                  className="min-h-16 font-mono text-xs"
                  spellCheck={false}
                />
                <p className="text-xs text-muted-foreground">
                  {t('bridges.cookieHeaderHint', { host: safeHost(params.url) })}
                </p>
              </div>
            )}
            {fields.map((field) => {
              const source = cookieSource(field) ?? field.sources?.[0];
              return (
                <div key={field.id} className="grid gap-1.5">
                  <Label htmlFor={`cookie-${field.id}`}>
                    {source?.name ?? field.id}
                    {!field.required && <span className="font-normal text-muted-foreground"> {t('bridges.optional')}</span>}
                  </Label>
                  <p className="-mt-0.5 text-xs text-muted-foreground">{sourceHint(source)}</p>
                  <Input
                    id={`cookie-${field.id}`}
                    value={values[field.id] ?? ''}
                    onChange={(e) => setValues((s) => ({ ...s, [field.id]: e.target.value }))}
                    aria-invalid={!!errors[field.id]}
                    spellCheck={false}
                    autoComplete="off"
                    className="font-mono text-xs"
                  />
                  {errors[field.id] && <p className="text-xs text-destructive">{errors[field.id]}</p>}
                </div>
              );
            })}
            <div className="flex justify-end">
              <Button type="submit" disabled={busy}>
                {busy && <LoaderCircle className="animate-spin" />}
                {t('bridges.signIn')}
              </Button>
            </div>
          </form>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
