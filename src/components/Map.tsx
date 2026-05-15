"use client";

import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export default function Map({ lat, lng, label }: { lat: number; lng: number; label: string }) {
  useEffect(() => {
    // Fix default icon issues with Webpack
    delete (L.Icon.Default.prototype as any)._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
      iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
      shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
    });
  }, []);

  const createYellowIcon = () => {
    return L.divIcon({
      className: 'custom-yellow-marker',
      html: `<div style="
        background-color: #ffeb3b; 
        width: 24px; 
        height: 24px; 
        border-radius: 50% 50% 50% 0; 
        border: 2px solid #f57f17; 
        transform: rotate(-45deg); 
        box-shadow: 2px 2px 5px rgba(0,0,0,0.5);
      "></div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 24],
    });
  };

  const position: [number, number] = [lat, lng];

  return (
    <div style={{ width: '100%', height: '300px', borderRadius: '8px', overflow: 'hidden', border: '1px solid #444', zIndex: 1 }}>
      <MapContainer 
        center={position} 
        zoom={17} 
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Marker position={position} icon={createYellowIcon()}>
          <Tooltip direction="top" offset={[0, -20]} opacity={1} permanent className="custom-tooltip">
            <div style={{ fontWeight: 'bold', fontSize: '14px', color: '#333' }}>
              {label || "工事名未入力"}
            </div>
          </Tooltip>
        </Marker>
      </MapContainer>
    </div>
  );
}
