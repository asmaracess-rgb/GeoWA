import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { ExtractedLocation } from '../utils/locationParser';
import { Compass, Layers, Maximize2, Navigation } from 'lucide-react';

interface InteractiveMapProps {
  locations: ExtractedLocation[];
  selectedId: string | null;
  onSelectLocation: (id: string) => void;
  onPickCoordinate?: (lat: number, lng: number) => void;
  singlePreviewPoint?: { lat: number; lng: number; label: string } | null;
}

export const InteractiveMap: React.FC<InteractiveMapProps> = ({
  locations,
  selectedId,
  onSelectLocation,
  onPickCoordinate,
  singlePreviewPoint,
}) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const onPickRef = useRef<typeof onPickCoordinate>(onPickCoordinate);
  const [mapStyle, setMapStyle] = useState<'osm' | 'clean'>('osm');

  useEffect(() => {
    onPickRef.current = onPickCoordinate;
  }, [onPickCoordinate]);

  // Initialize Leaflet map once
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [-6.2088, 106.8456],
      zoom: 11,
      zoomControl: true,
    });

    map.on('click', (e: L.LeafletMouseEvent) => {
      onPickRef.current?.(Number(e.latlng.lat.toFixed(6)), Number(e.latlng.lng.toFixed(6)));
    });

    const tileUrl =
      mapStyle === 'osm'
        ? 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
        : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';

    const tileLayer = L.tileLayer(tileUrl, {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    const markersGroup = L.layerGroup().addTo(map);

    mapInstanceRef.current = map;
    tileLayerRef.current = tileLayer;
    markersLayerRef.current = markersGroup;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Handle tile style switch
  useEffect(() => {
    if (!mapInstanceRef.current || !tileLayerRef.current) return;
    const newUrl =
      mapStyle === 'osm'
        ? 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
        : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
    tileLayerRef.current.setUrl(newUrl);
  }, [mapStyle]);

  // Render markers and route polyline when locations or singlePreviewPoint change
  useEffect(() => {
    const map = mapInstanceRef.current;
    const group = markersLayerRef.current;
    if (!map || !group) return;

    group.clearLayers();

    if (singlePreviewPoint) {
      const icon = L.divIcon({
        className: 'custom-wa-pin',
        html: `<div style="
          width: 32px;
          height: 32px;
          border-radius: 9999px;
          background: #0f172a;
          color: #ffffff;
          border: 3px solid #10b981;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          font-weight: 700;
          box-shadow: 0 4px 12px rgba(15, 23, 42, 0.28);
        ">ID</div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });

      const marker = L.marker([singlePreviewPoint.lat, singlePreviewPoint.lng], { icon });
      marker.bindPopup(
        `<div style="font-family: 'DM Sans', sans-serif; min-width: 180px;">
          <div style="font-weight: 600; color: #0f172a; margin-bottom: 4px;">${singlePreviewPoint.label}</div>
          <div style="font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #475569;">
            ${singlePreviewPoint.lat.toFixed(4)}, ${singlePreviewPoint.lng.toFixed(4)}
          </div>
        </div>`
      );
      marker.addTo(group);

      L.circle([singlePreviewPoint.lat, singlePreviewPoint.lng], {
        radius: 3500,
        color: '#059669',
        weight: 1.5,
        fillColor: '#10b981',
        fillOpacity: 0.1,
      }).addTo(group);

      map.setView([singlePreviewPoint.lat, singlePreviewPoint.lng], 11, { animate: true });
      return;
    }

    if (locations.length === 0) return;

    const latLngs: L.LatLngExpression[] = [];

    locations.forEach((loc) => {
      const isSelected = loc.id === selectedId;
      latLngs.push([loc.latitude, loc.longitude]);

      const pinHtml = `<div style="
        width: ${isSelected ? '34px' : '28px'};
        height: ${isSelected ? '34px' : '28px'};
        border-radius: 9999px;
        background: ${isSelected ? '#059669' : '#0f172a'};
        color: #ffffff;
        border: ${isSelected ? '3px solid #ffffff' : '2px solid #ffffff'};
        outline: ${isSelected ? '2px solid #059669' : '1px solid #0f172a'};
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: 'JetBrains Mono', monospace;
        font-size: 12px;
        font-weight: 600;
        box-shadow: 0 3px 10px rgba(15, 23, 42, 0.25);
        cursor: pointer;
      ">${loc.index}</div>`;

      const icon = L.divIcon({
        className: 'custom-wa-marker',
        html: pinHtml,
        iconSize: isSelected ? [34, 34] : [28, 28],
        iconAnchor: isSelected ? [17, 17] : [14, 14],
      });

      const marker = L.marker([loc.latitude, loc.longitude], {
        icon,
        draggable: isSelected && Boolean(onPickCoordinate),
      });
      marker.on('click', () => {
        onSelectLocation(loc.id);
      });
      marker.on('dragend', () => {
        const pos = marker.getLatLng();
        onPickCoordinate?.(Number(pos.lat.toFixed(6)), Number(pos.lng.toFixed(6)));
      });

      marker.bindPopup(
        `<div style="font-family: 'DM Sans', sans-serif; min-width: 210px;">
          <div style="font-size: 11px; color: #64748b; margin-bottom: 2px;">Titik #${loc.index} · ${loc.timestamp}</div>
          <div style="font-weight: 600; color: #0f172a; font-size: 13px; margin-bottom: 4px;">${loc.sender}</div>
          <div style="font-size: 12px; color: #334155; margin-bottom: 6px;">${loc.resolvedAddress || loc.estimatedRegion}</div>
          <div style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #059669; background: #f8fafc; padding: 4px 6px; border-radius: 4px; border: 1px solid #e2e8f0;">
            ${loc.latitude.toFixed(6)}, ${loc.longitude.toFixed(6)}
          </div>
        </div>`
      );

      marker.addTo(group);

      if (isSelected) {
        L.circle([loc.latitude, loc.longitude], {
          radius: 120,
          color: '#059669',
          weight: 1.5,
          fillColor: '#10b981',
          fillOpacity: 0.14,
        }).addTo(group);
      }
    });

    if (latLngs.length > 1) {
      L.polyline(latLngs, {
        color: '#059669',
        weight: 2.5,
        dashArray: '6, 6',
        opacity: 0.85,
      }).addTo(group);
    }

    const selectedLoc = locations.find((l) => l.id === selectedId);
    if (selectedLoc) {
      map.setView([selectedLoc.latitude, selectedLoc.longitude], Math.max(map.getZoom(), 16), {
        animate: true,
      });
    } else if (latLngs.length === 1) {
      map.setView(latLngs[0], 16, { animate: true });
    } else {
      const bounds = L.latLngBounds(latLngs);
      map.fitBounds(bounds, { padding: [44, 44], maxZoom: 16 });
    }
  }, [locations, selectedId, singlePreviewPoint]);

  const handleFitAll = () => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (singlePreviewPoint) {
      map.setView([singlePreviewPoint.lat, singlePreviewPoint.lng], 11, { animate: true });
      return;
    }
    if (locations.length === 0) return;
    if (locations.length === 1) {
      map.setView([locations[0].latitude, locations[0].longitude], 14, { animate: true });
      return;
    }
    const bounds = L.latLngBounds(locations.map((l) => [l.latitude, l.longitude] as [number, number]));
    map.fitBounds(bounds, { padding: [44, 44], maxZoom: 15 });
  };

  return (
    <div className="relative w-full h-full min-h-[380px] bg-slate-100 rounded-lg overflow-hidden border border-slate-200">
      <div ref={mapContainerRef} className="w-full h-full min-h-[380px]" />

      {/* Top-right floating map toolbar */}
      <div className="absolute top-3 right-3 z-20 flex items-center gap-1.5 bg-white/95 backdrop-blur-sm p-1 rounded-md border border-slate-200 shadow-xs">
        <button
          type="button"
          onClick={() => setMapStyle(mapStyle === 'osm' ? 'clean' : 'osm')}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 hover:bg-slate-100 rounded transition-colors whitespace-nowrap shrink-0"
          title="Ganti lapisan tampilan peta"
        >
          <Layers className="w-3.5 h-3.5 text-slate-500" />
          <span>{mapStyle === 'osm' ? 'Peta Detail' : 'Peta Kontras'}</span>
        </button>
        <button
          type="button"
          onClick={handleFitAll}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 hover:bg-slate-100 rounded transition-colors whitespace-nowrap shrink-0"
          title="Tampilkan seluruh titik di layar"
        >
          <Maximize2 className="w-3.5 h-3.5 text-slate-500" />
          <span>Reset Zoom</span>
        </button>
      </div>

      {/* Bottom-left coordinate summary bar */}
      <div className="absolute bottom-3 left-3 z-20 bg-white/95 backdrop-blur-sm px-3 py-1.5 rounded-md border border-slate-200 text-xs text-slate-600 flex items-center gap-2">
        <Compass className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
        {singlePreviewPoint ? (
          <span className="font-mono tabular-nums">
            {singlePreviewPoint.lat.toFixed(4)}, {singlePreviewPoint.lng.toFixed(4)} · {singlePreviewPoint.label}
          </span>
        ) : locations.length > 0 ? (
          <span>
            Menampilkan <strong className="font-mono tabular-nums text-slate-900">{locations.length}</strong> titik koordinat pesan
          </span>
        ) : (
          <span>Belum ada koordinat yang dipetakan</span>
        )}
      </div>
    </div>
  );
};
