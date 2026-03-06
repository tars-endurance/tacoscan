const NETWORK_CONFIGS = {
  mainnet: {
    subgraphPolygon:  'https://api.goldsky.com/api/public/project_cmgzo6cgq00lc5np2dwaycfdl/subgraphs/taco-mainnet-polygon/latest/gn',
    subgraphEthereum: 'https://api.goldsky.com/api/public/project_cmgzo6cgq00lc5np2dwaycfdl/subgraphs/taco-mainnet-ethereum/latest/gn',
    subgraphBase:     'https://api.goldsky.com/api/public/project_cmgzo6cgq00lc5np2dwaycfdl/subgraphs/taco-mainnet-base/latest/gn',
    rpcEth:     'https://ethereum-rpc.publicnode.com',
    rpcPolygon: 'https://polygon-bor-rpc.publicnode.com',
    etherscan:    'https://etherscan.io',
    polygonscan:  'https://polygonscan.com',
    coordinator:  '0xe74259e3dafe30baa8700238e324b47ac98fe755',
  },
  lynx: {
    subgraphPolygon:  'https://api.goldsky.com/api/public/project_cmgzo6cgq00lc5np2dwaycfdl/subgraphs/taco-lynx-polygon/latest/gn',
    subgraphEthereum: 'https://api.goldsky.com/api/public/project_cmgzo6cgq00lc5np2dwaycfdl/subgraphs/taco-lynx-ethereum/latest/gn',
    subgraphBase:     'https://api.goldsky.com/api/public/project_cmgzo6cgq00lc5np2dwaycfdl/subgraphs/taco-lynx-base/latest/gn',
    rpcEth:     'https://sepolia.infura.io/v3/0b802427db2e42e18e8eadd1ec01f934',
    rpcPolygon: 'https://polygon-amoy.infura.io/v3/0b802427db2e42e18e8eadd1ec01f934',
    etherscan:    'https://sepolia.etherscan.io',
    polygonscan:  'https://amoy.polygonscan.com',
    coordinator:  null,
  },
  tapir: {
    subgraphPolygon:  'https://api.goldsky.com/api/public/project_cmgzo6cgq00lc5np2dwaycfdl/subgraphs/taco-tapir-polygon/latest/gn',
    subgraphEthereum: 'https://api.goldsky.com/api/public/project_cmgzo6cgq00lc5np2dwaycfdl/subgraphs/taco-tapir-ethereum/latest/gn',
    subgraphBase:     'https://api.goldsky.com/api/public/project_cmgzo6cgq00lc5np2dwaycfdl/subgraphs/taco-tapir-base/latest/gn',
    rpcEth:     'https://sepolia.infura.io/v3/0b802427db2e42e18e8eadd1ec01f934',
    rpcPolygon: 'https://polygon-amoy.infura.io/v3/0b802427db2e42e18e8eadd1ec01f934',
    etherscan:    'https://sepolia.etherscan.io',
    polygonscan:  'https://amoy.polygonscan.com',
    coordinator:  null,
  },
};

export const detectNetwork = () => {
  if (import.meta.env.VITE_NETWORK) return import.meta.env.VITE_NETWORK;
  const host = typeof window !== 'undefined' ? window.location.hostname : '';
  if (host.includes('lynx'))  return 'lynx';
  if (host.includes('tapir')) return 'tapir';
  return 'mainnet';
};

export const CURRENT_NETWORK = detectNetwork();
export const networkConfig = NETWORK_CONFIGS[CURRENT_NETWORK] ?? NETWORK_CONFIGS.mainnet;
export default networkConfig;
