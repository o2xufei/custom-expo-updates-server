/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: '/recipeUpdate',
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: '/api/:path*', // 保持API路径不变
      },
      {
        source: '/:path*',
        destination: '/:path*',
      },
    ];
  },
  // 添加日志配置
  // onError: (err) => {
  //   console.error('Next.js Global Error:', err);
  // },
  // 确保API路由能正确处理子路径
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
    ];
    // return [
    //   {
    //     source: '/api/:path*',
    //     headers: [
    //       {
    //         key: 'x-base-path',
    //         value: '/',
    //       },
    //     ],
    //   },
    // ];
  },
};

// 启用详细日志
if (process.env.NODE_ENV === 'development') {
  nextConfig.webpack = (config, { dev, isServer }) => {
    if (dev && isServer) {
      console.log('Enabling detailed logging in development mode');
    }
    return config;
  };
}

module.exports = nextConfig;