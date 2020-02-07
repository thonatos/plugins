export default () => {
  return {
    plugins: [
      require.resolve('@umijs/plugin-antd'),
      require.resolve('@umijs/plugin-dva'),
      require.resolve('@umijs/plugin-locale'),
      require.resolve('@umijs/plugin-model'),
      require.resolve('./plugins/crossorigin/crossorigin'),
    ],
  };
};