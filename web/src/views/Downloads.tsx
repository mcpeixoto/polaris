import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Logo } from '~/components';
import { isSignedIn } from '~/sync/api';
import { DOWNLOADS, fetchRelease, RELEASES_URL, type Release } from '~/features/downloads/releases';
import styles from './Downloads.module.css';

export function Downloads() {
  const signedIn = isSignedIn();
  const [release, setRelease] = useState<Release | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timeout = window.setTimeout(() => controller.abort(), 10000);
    void fetchRelease(controller.signal)
      .then(
        (result) => {
          if (active) setRelease(result);
        },
        () => {
          if (active) setFailed(true);
        },
      )
      .finally(() => window.clearTimeout(timeout));
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, []);

  return (
    <div className={styles.page}>
      <a className={styles.skip} href="#downloads-main">
        Skip to content
      </a>
      <header className={styles.header}>
        <Link to="/welcome" aria-label="Polaris — home">
          <Logo />
        </Link>
        <Link to={signedIn ? '/' : '/signin'} className={styles.quiet}>
          {signedIn ? 'Open workspace' : 'Sign in'}
        </Link>
      </header>
      <main id="downloads-main" className={styles.main}>
        <p className={styles.kicker}>Polaris for desktop</p>
        <h1>
          Your workspace.
          <br />
          On your desktop.
        </h1>
        <p className={styles.lead}>
          The same Polaris, with native notifications, keyboard shortcuts and your workspace
          available offline.
        </p>
        <p className={styles.status} role="status">
          {release
            ? `Latest release · ${release.version}`
            : failed
              ? 'We couldn’t load the latest downloads. You can still get Polaris from GitHub Releases.'
              : 'Finding the latest release…'}
        </p>
        <div className={styles.grid}>
          {(['macOS', 'Windows', 'Linux'] as const).map((platform) => (
            <section className={styles.card} key={platform} aria-label={`${platform} downloads`}>
              <h2>{platform}</h2>
              {DOWNLOADS.filter((item) => item.platform === platform).map((item) => {
                const url = release?.downloads[item.id];
                return (
                  <div className={styles.option} key={item.id}>
                    <p>{item.label}</p>
                    {url ? (
                      <a href={url} className={styles.download}>
                        Download {item.format} <span aria-hidden="true">↓</span>
                      </a>
                    ) : (
                      <p className={styles.unavailable}>
                        {release
                          ? 'Unavailable in this release'
                          : failed
                            ? 'See GitHub Releases below'
                            : 'Checking availability…'}
                      </p>
                    )}
                  </div>
                );
              })}
              <p className={styles.note}>
                {platform === 'macOS'
                  ? 'Choose Apple Silicon for M-series Macs, or Intel for older Macs.'
                  : platform === 'Windows'
                    ? 'One installer for Intel, AMD and ARM64 PCs.'
                    : 'AppImage updates in the app. For DEB, download and install the newer package.'}
              </p>
            </section>
          ))}
        </div>
        <footer className={styles.footer}>
          <a href={RELEASES_URL}>All releases and release notes ↗</a>
          <Link to={signedIn ? '/' : '/signup'}>
            {signedIn ? 'Open workspace' : 'Get started in your browser'} →
          </Link>
          <p>
            Use Check for Updates in the app to check for new releases. Works with Polaris Cloud and
            self-hosted servers.
          </p>
        </footer>
      </main>
    </div>
  );
}
