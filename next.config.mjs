import withPWA from 'next-pwa';
import { withSentryConfig } from '@sentry/nextjs';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // NEXT_DIST_DIR: build into another folder (e.g. .next-build) so a local production build can run while
  // `next dev` is using .next; the two writing the same folder breaks both. Unset everywhere else: .next as before.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // The myQode app's web build (myqode-native → npm run build:web → public/app). It is a single-page app:
  // files under /app/_expo are served as they are; every other /app path gets its index.html.
  async rewrites() {
    return [
      { source: '/app', destination: '/app/index.html' },
      { source: '/app/:path((?!_expo|assets).*)', destination: '/app/index.html' },
    ]
  },
  // The revamped myQode (the app's web build at /app) is the site: the homepage and the old sign-in page open it.
  // The old portal's other pages (and /admin) are left as they are. Temporary (307) so it can be undone any time.
  async redirects() {
    return [
      { source: '/', destination: '/app', permanent: false },
      { source: '/login', destination: '/app', permanent: false },
    ]
  },
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET,POST,PUT,DELETE,OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization, X-Client-Type, x-app-version, x-device' },
          { key: 'Access-Control-Max-Age', value: '86400' },
        ],
      },
    ]
  },
  experimental: {
    serverActions: {
      allowedOrigins: [
      'localhost:3001', 
      'localhost:3000',
      'localhost:3002',
      'localhost:3010',  // Add your production port
      'localhost:2069',  // Add your production port
      '192.168.0.110:2069', // Replace with YOUR IP
      'bh05pcfr-3001.inc1.devtunnels.ms',
      '3efa0ae8e033.ngrok-free.app',
      '8qgjiaiyn5bd.share.zrok.io'
    ]
    }
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Replace Node.js modules with empty objects in client-side bundles
      config.resolve.fallback = {
        ...config.resolve.fallback,
        crypto: false,
        fs: false,
        net: false,
        tls: false,
        child_process: false,
      };
    }
    return config;
  },
};

const pwaConfig = withPWA({
  sourcemap: false, // no service-worker source maps in production
  dest: 'public',
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === 'development', // ✅ Disable in dev
  buildExcludes: [
    /middleware-manifest\.json$/,
    /build-manifest\.json$/,
    /app-build-manifest\.json$/,
    /_buildManifest\.js$/,
    /_ssgManifest\.js$/,
  ],
  publicExcludes: ['!robots.txt', '!sitemap.xml'],
  scope: '/',
  sw: 'sw.js',
  // Don't precache these patterns
  manifestTransforms: [
    (manifestEntries) => {
      const manifest = manifestEntries.filter((entry) => {
        // Exclude build manifests and problematic files
        return !entry.url.includes('build-manifest') &&
               !entry.url.includes('_buildManifest') &&
               !entry.url.includes('_ssgManifest') &&
               !entry.url.includes('middleware-manifest')
      })
      return { manifest, warnings: [] }
    },
  ],
  runtimeCaching: [
    {
      urlPattern: /^https:\/\/fonts\.(?:gstatic)\.com\/.*/i,
      handler: 'CacheFirst',
      options: {
        cacheName: 'google-fonts-webfonts',
        expiration: {
          maxEntries: 4,
          maxAgeSeconds: 365 * 24 * 60 * 60
        }
      }
    },
    {
      urlPattern: /^https:\/\/fonts\.(?:googleapis)\.com\/.*/i,
      handler: 'StaleWhileRevalidate',
      options: {
        cacheName: 'google-fonts-stylesheets',
        expiration: {
          maxEntries: 4,
          maxAgeSeconds: 7 * 24 * 60 * 60
        }
      }
    },
    {
      urlPattern: /\.(?:jpg|jpeg|gif|png|svg|ico|webp)$/i,
      handler: 'StaleWhileRevalidate',
      options: {
        cacheName: 'static-image-assets',
        expiration: {
          maxEntries: 64,
          maxAgeSeconds: 24 * 60 * 60
        }
      }
    },
    {
      urlPattern: /\.(?:js)$/i,
      handler: 'StaleWhileRevalidate',
      options: {
        cacheName: 'static-js-assets',
        expiration: {
          maxEntries: 32,
          maxAgeSeconds: 24 * 60 * 60
        }
      }
    },
    {
      urlPattern: /\.(?:css|less)$/i,
      handler: 'StaleWhileRevalidate',
      options: {
        cacheName: 'static-style-assets',
        expiration: {
          maxEntries: 32,
          maxAgeSeconds: 24 * 60 * 60
        }
      }
    },
    {
      urlPattern: /\/_next\/data\/.+\/.+\.json$/i,
      handler: 'StaleWhileRevalidate',
      options: {
        cacheName: 'next-data',
        expiration: {
          maxEntries: 32,
          maxAgeSeconds: 24 * 60 * 60
        }
      }
    },
    {
      urlPattern: ({ url }) => {
        const isSameOrigin = self.origin === url.origin;
        if (!isSameOrigin) return false;
        const pathname = url.pathname;
        // Exclude /api/ routes from being cached
        if (pathname.startsWith('/api/')) return false;
        return true;
      },
      handler: 'NetworkFirst',
      options: {
        cacheName: 'others',
        expiration: {
          maxEntries: 32,
          maxAgeSeconds: 24 * 60 * 60
        },
        networkTimeoutSeconds: 10
      }
    }
  ]
})(nextConfig);

/**
 * Source-map upload runs only where SENTRY_AUTH_TOKEN is set — CI, never a
 * developer's machine. Without it the build is unchanged and errors still
 * report; only readable file names and line numbers are missing.
 */
export default withSentryConfig(pwaConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  sentryUrl: process.env.SENTRY_URL,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  sourcemaps: { deleteSourcemapsAfterUpload: true },
  disableLogger: true,
  telemetry: false,
});