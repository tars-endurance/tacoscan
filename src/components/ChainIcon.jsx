import React from 'react';

const SIZE = 16;

const EthIcon = ({ size = SIZE }) => (
  <svg width={size} height={size} viewBox="0 0 256 417" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M127.961 0L125.166 9.5V285.168L127.961 287.958L255.923 212.32L127.961 0Z" fill="#343434"/>
    <path d="M127.962 0L0 212.32L127.962 287.958V154.158V0Z" fill="#8C8C8C"/>
    <path d="M127.961 312.187L126.386 314.107V412.306L127.961 416.905L255.999 236.587L127.961 312.187Z" fill="#3C3C3B"/>
    <path d="M127.962 416.905V312.187L0 236.587L127.962 416.905Z" fill="#8C8C8C"/>
    <path d="M127.961 287.958L255.923 212.32L127.961 154.158V287.958Z" fill="#141414"/>
    <path d="M0 212.32L127.962 287.958V154.158L0 212.32Z" fill="#393939"/>
  </svg>
);

const BaseIcon = ({ size = SIZE }) => (
  <svg width={size} height={size} viewBox="0 0 111 111" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="55.5" cy="55.5" r="55.5" fill="#0052FF"/>
    <path d="M55.3909 93.2C76.2816 93.2 93.2909 76.1907 93.2909 55.3C93.2909 34.4093 76.2816 17.4 55.3909 17.4C35.5589 17.4 19.2436 32.7437 17.6 52.1H67.6V58.5H17.6C19.2436 77.8563 35.5589 93.2 55.3909 93.2Z" fill="white"/>
  </svg>
);

const PolygonIcon = ({ size = SIZE }) => (
  <svg width={size} height={size} viewBox="0 0 178 200" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M133.735 50.218L96.718 28.837C91.702 25.943 85.498 25.943 80.282 28.837L43.265 50.218C38.249 53.112 35.047 58.502 35.047 64.29V107.052C35.047 112.84 38.249 118.23 43.265 121.124L80.282 142.505C85.298 145.399 91.502 145.399 96.718 142.505L133.735 121.124C138.751 118.23 141.953 112.84 141.953 107.052V64.29C141.953 58.502 138.751 53.112 133.735 50.218Z" fill="#8247E5"/>
  </svg>
);

const SepoliaIcon = ({ size = SIZE }) => (
  <svg width={size} height={size} viewBox="0 0 256 417" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M127.961 0L125.166 9.5V285.168L127.961 287.958L255.923 212.32L127.961 0Z" fill="#7B8794"/>
    <path d="M127.962 0L0 212.32L127.962 287.958V154.158V0Z" fill="#B0BEC5"/>
    <path d="M127.961 312.187L126.386 314.107V412.306L127.961 416.905L255.999 236.587L127.961 312.187Z" fill="#7B8794"/>
    <path d="M127.962 416.905V312.187L0 236.587L127.962 416.905Z" fill="#B0BEC5"/>
  </svg>
);

const CHAIN_ICONS = {
  '1':        EthIcon,
  '137':      PolygonIcon,
  '8453':     BaseIcon,
  '11155111': SepoliaIcon,
  '84532':    BaseIcon,     // Base Sepolia
  '80001':    PolygonIcon,  // Mumbai
  '80002':    PolygonIcon,  // Amoy
};

const CHAIN_NAMES = {
  '1':        'Ethereum',
  '137':      'Polygon',
  '8453':     'Base',
  '11155111': 'Sepolia',
  '84532':    'Base Sepolia',
  '80001':    'Mumbai',
  '80002':    'Amoy',
};

export default function ChainIcon({ chainId, size = SIZE, showLabel = false }) {
  const id = String(chainId);
  const Icon = CHAIN_ICONS[id];
  const name = CHAIN_NAMES[id] || `Chain ${id}`;

  if (!Icon) return <span title={name}>{name}</span>;

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} title={name}>
      <Icon size={size} />
      {showLabel && <span>{name}</span>}
    </span>
  );
}
