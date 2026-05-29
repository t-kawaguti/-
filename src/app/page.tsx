"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import Webcam from "react-webcam";
import { Camera, Save, FileText, History, X, LogIn, LogOut, Home as HomeIcon, Folder, FileSpreadsheet, ChevronRight, FilePlus, FolderOpen, Image as ImageIcon, MapPin, ClipboardList } from "lucide-react";
import { useSession, signIn, signOut } from "next-auth/react";
import dynamic from "next/dynamic";
import styles from "./page.module.css";

const MapView = dynamic(() => import("../components/Map"), { 
  ssr: false, 
  loading: () => <div style={{ height: "300px", display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "#222", borderRadius: "8px" }}>マップを読み込み中...</div> 
});

type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
  thumbnailLink?: string;
  modifiedTime?: string;
};

type Breadcrumb = {
  id: string;
  name: string;
  level: number;
};

type HistoryRecord = {
  id: string;
  constructionName: string;
  contractorName?: string;
  details?: string;
  date: string;
  fileLink: string;
};

export default function Home() {
  const [activeTab, setActiveTab] = useState<"details" | "history" | "camera">("details");

  const [constructionName, setConstructionName] = useState("");
  const [contractorName, setContractorName] = useState("");
  const [details, setDetails] = useState("");
  const [record, setRecord] = useState("");
  const [saveFolderName, setSaveFolderName] = useState("");
  
  // 新機能: 黒板タイプと寸法、画像
  const [blackboardType, setBlackboardType] = useState<"standard" | "large">("standard");
  const [dimensions, setDimensions] = useState("");
  const [selectedImageBase64, setSelectedImageBase64] = useState<string | null>(null);

  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [address, setAddress] = useState("位置情報を取得中...");
  const [isSyncing, setIsSyncing] = useState(false);
  
  const [capturedImages, setCapturedImages] = useState<string[]>([]);
  const webcamRef = useRef<Webcam>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number>();
  
  // Drive Explorer State
  const [driveFiles, setDriveFiles] = useState<DriveFile[]>([]);
  const [isLoadingDrive, setIsLoadingDrive] = useState(false);
  const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb[]>([{ id: "root", name: "工事記録", level: 0 }]);

  // History Load Modal
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [localHistory, setLocalHistory] = useState<HistoryRecord[]>([]);

  // Blackboard Images Modal
  const [showDriveImageModal, setShowDriveImageModal] = useState(false);
  const [driveImages, setDriveImages] = useState<DriveFile[]>([]);
  const [isLoadingImages, setIsLoadingImages] = useState(false);

  // Camera Zoom & Blackboard State
  const [zoomLevel, setZoomLevel] = useState(1);
  const [maxZoom, setMaxZoom] = useState(3);
  const [isZoomSupported, setIsZoomSupported] = useState(true);
  const [showBlackboard, setShowBlackboard] = useState(true);

  // プリセット関連の状態
  const [presets, setPresets] = useState<any[]>([]);
  const [showPresetModal, setShowPresetModal] = useState(false);
  const [isLoadingPresets, setIsLoadingPresets] = useState(false);
  const [isSavingPreset, setIsSavingPreset] = useState(false);

  const { data: session } = useSession();

  const videoConstraints = {
    facingMode: "environment"
  };

  // 1. On Mount Load
  useEffect(() => {
    const savedWork = localStorage.getItem("app_current_work");
    if (savedWork) {
      try {
        const parsed = JSON.parse(savedWork);
        if (parsed.constructionName) setConstructionName(parsed.constructionName);
        if (parsed.contractorName) setContractorName(parsed.contractorName);
        if (parsed.details) setDetails(parsed.details);
        if (parsed.record) setRecord(parsed.record);
        if (parsed.saveFolderName) setSaveFolderName(parsed.saveFolderName);
        if (parsed.blackboardType) setBlackboardType(parsed.blackboardType);
        if (parsed.dimensions) setDimensions(parsed.dimensions);
      } catch (e) {}
    }

    const historyData = localStorage.getItem("app_records_history");
    if (historyData) {
      try { setLocalHistory(JSON.parse(historyData)); } catch (e) {}
    }

    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const { latitude, longitude } = position.coords;
          setLocation({ lat: latitude, lng: longitude });
          try {
            const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`);
            const data = await res.json();
            const addr = data.address || {};
            const province = addr.province || addr.state || "";
            const city = addr.city || addr.town || addr.county || "";
            const area = addr.suburb || addr.village || addr.neighbourhood || addr.quarter || "";
            const displayName = `${province}${city}${area}` || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
            setAddress(displayName);
          } catch (e) {
            setAddress(`${latitude.toFixed(4)}, ${longitude.toFixed(4)}`);
          }
        },
        (error) => console.error(error),
        { enableHighAccuracy: true }
      );
    }
  }, []);

  const initDefaultPresets = useCallback(() => {
    const defaultPresets = Array.from({ length: 10 }, (_, i) => ({
      id: String(i + 1).padStart(2, '0'),
      constructionName: "",
      contractorName: "",
      details: ""
    }));
    setPresets(defaultPresets);
  }, []);

  const fetchPresets = useCallback(async () => {
    if (!session) return;
    setIsLoadingPresets(true);
    try {
      const res = await fetch("/api/presets");
      const data = await res.json();
      if (Array.isArray(data)) {
        setPresets(data);
      } else {
        initDefaultPresets();
      }
    } catch (e) {
      console.error("Failed to fetch presets", e);
      initDefaultPresets();
    } finally {
      setIsLoadingPresets(false);
    }
  }, [session, initDefaultPresets]);

  useEffect(() => {
    if (session) {
      fetchPresets();
    } else {
      setPresets([]);
    }
  }, [session, fetchPresets]);

  // URLからeditFileIdを取得して再編集データをロードする
  useEffect(() => {
    const loadExcelData = async (fileId: string) => {
      try {
        const res = await fetch(`/api/drive/read-excel?fileId=${fileId}`);
        const result = await res.json();
        if (result.success && result.data) {
          const data = result.data;
          if (data.constructionName) {
            setConstructionName(data.constructionName);
            setSaveFolderName(data.constructionName);
          }
          if (data.contractorName) setContractorName(data.contractorName);
          if (data.details) setDetails(data.details);
          if (data.record) setRecord(data.record);
          if (data.address) setAddress(data.address);
          if (data.location) setLocation(data.location);
          if (data.blackboardType) setBlackboardType(data.blackboardType);
          if (data.dimensions) setDimensions(data.dimensions);

          alert("Excelから編集データを読み込みました！");
          
          // URLのパラメータをクリアしてリロード時の多重ロードを防ぐ
          const url = new URL(window.location.href);
          url.searchParams.delete("editFileId");
          window.history.replaceState({}, document.title, url.pathname + url.search);
        } else {
          alert("Excelデータの読み込みに失敗しました: " + (result.error || "エラーが発生しました"));
        }
      } catch (e) {
        console.error(e);
        alert("通信エラーによりExcelデータを読み込めませんでした");
      }
    };

    const urlParams = new URLSearchParams(window.location.search);
    const editFileId = urlParams.get("editFileId");
    if (editFileId) {
      if (session) {
        loadExcelData(editFileId);
      } else {
        // 未ログイン時はログインを促す
        if (window.confirm("Excelからデータを復元するにはGoogleログインが必要です。ログインしますか？")) {
          signIn("google");
        }
      }
    }
  }, [session]);

  const [showSaveToast, setShowSaveToast] = useState(false);

  // 2. Auto-save current work
  useEffect(() => {
    const timer = setTimeout(() => {
      localStorage.setItem("app_current_work", JSON.stringify({
        constructionName, contractorName, details, record, saveFolderName, blackboardType, dimensions
      }));
    }, 1000);
    return () => clearTimeout(timer);
  }, [constructionName, contractorName, details, record, saveFolderName, blackboardType, dimensions]);

  const handleManualSave = () => {
    localStorage.setItem("app_current_work", JSON.stringify({
      constructionName, contractorName, details, record, saveFolderName, blackboardType, dimensions
    }));
    setShowSaveToast(true);
    setTimeout(() => setShowSaveToast(false), 2000);
  };

  const handleNewRegistration = () => {
    if (window.confirm("入力内容をクリアして新規の入力を始めますか？")) {
      setConstructionName("");
      setContractorName("");
      setDetails("");
      setRecord("");
      setSaveFolderName("");
      setDimensions("");
      setSelectedImageBase64(null);
      setShowSaveToast(false);
    }
  };

  const handleApplyPreset = (preset: any) => {
    if (!preset.constructionName && !preset.contractorName && !preset.details) {
      alert("選択されたプリセットにはデータが登録されていません");
      return;
    }
    if (window.confirm(`プリセット「${preset.id}」の内容を適用しますか？\n（現在の入力内容は上書きされます）`)) {
      setConstructionName(preset.constructionName || "");
      setContractorName(preset.contractorName || "");
      setDetails(preset.details || "");
      setSaveFolderName(preset.constructionName || "");
      setShowPresetModal(false);
    }
  };

  const handleSavePreset = async (presetId: string) => {
    if (!session) {
      alert("Googleにログインしてください");
      return;
    }
    if (!window.confirm(`現在の入力内容でプリセット「${presetId}」を上書き保存しますか？`)) {
      return;
    }

    setIsSavingPreset(true);
    try {
      const updatedPresets = presets.map(p => {
        if (p.id === presetId) {
          return {
            id: presetId,
            constructionName,
            contractorName,
            details
          };
        }
        return p;
      });

      const res = await fetch("/api/presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedPresets),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setPresets(updatedPresets);
        alert(`プリセット「${presetId}」を保存しました`);
      } else {
        alert("プリセットの保存に失敗しました: " + (data.error || "Unknown error"));
      }
    } catch (e) {
      alert("通信エラーが発生しました");
      console.error(e);
    } finally {
      setIsSavingPreset(false);
    }
  };

  const handleLoadFromHistory = (item: HistoryRecord) => {
    if (window.confirm(`「${item.constructionName}」のデータを読み込みますか？\n（現在の入力内容は上書きされます）`)) {
      setConstructionName(item.constructionName);
      if (item.contractorName) setContractorName(item.contractorName);
      if (item.details) setDetails(item.details);
      setSaveFolderName(item.constructionName);
      setShowHistoryModal(false);
    }
  };

  const fetchDriveContents = async (folderId: string, folderName: string, nextLevel: number) => {
    if (!session) return;
    setIsLoadingDrive(true);
    try {
      const res = await fetch(`/api/drive/list?folderId=${folderId}&level=${nextLevel}`);
      const data = await res.json();
      if (data.files) {
        setDriveFiles(data.files);
        const crumbIndex = breadcrumbs.findIndex(b => b.id === folderId);
        if (crumbIndex >= 0) {
          setBreadcrumbs(breadcrumbs.slice(0, crumbIndex + 1));
        } else {
          setBreadcrumbs([...breadcrumbs, { id: folderId === "root" ? data.currentFolderId : folderId, name: folderName, level: nextLevel }]);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoadingDrive(false);
    }
  };

  useEffect(() => {
    if (activeTab === "history" && driveFiles.length === 0) {
      fetchDriveContents("root", "工事記録", 0);
    }
  }, [activeTab, session]);

  const handleDriveItemClick = (file: DriveFile) => {
    if (file.mimeType === "application/vnd.google-apps.folder") {
      const currentLevel = breadcrumbs[breadcrumbs.length - 1]?.level ?? 0;
      fetchDriveContents(file.id, file.name, currentLevel + 1);
    } else if (file.webViewLink) {
      window.open(file.webViewLink, "_blank");
    }
  };

  // Fetch blackboard images from Drive
  const fetchBlackboardImages = async () => {
    if (!session) {
      alert("Googleにログインしてください");
      return;
    }
    setIsLoadingImages(true);
    setShowDriveImageModal(true);
    try {
      const res = await fetch("/api/drive/blackboard-images");
      const data = await res.json();
      if (data.success) {
        setDriveImages(data.images);
      } else {
        alert("画像の取得に失敗しました: " + data.error);
      }
    } catch (e) {
      alert("通信エラーが発生しました");
    } finally {
      setIsLoadingImages(false);
    }
  };

  const handleSelectDriveImage = async (fileId: string) => {
    setIsLoadingImages(true);
    try {
      const res = await fetch(`/api/drive/image?fileId=${fileId}`);
      const data = await res.json();
      if (data.success) {
        setSelectedImageBase64(data.dataUri);
        setShowDriveImageModal(false);
      } else {
        alert("画像のダウンロードに失敗しました: " + data.error);
      }
    } catch (e) {
      alert("通信エラーが発生しました");
    } finally {
      setIsLoadingImages(false);
    }
  };

  // --- Realtime Blackboard Rendering ---
  const blackboardImageElement = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    if (selectedImageBase64) {
      const img = new Image();
      img.onload = () => {
        blackboardImageElement.current = img;
      };
      img.src = selectedImageBase64;
    } else {
      blackboardImageElement.current = null;
    }
  }, [selectedImageBase64]);

  const drawBlackboard = useCallback((ctx: CanvasRenderingContext2D, width: number, height: number) => {
    // Determine size based on type
    let boardWidth, boardHeight;
    if (blackboardType === "large") {
      boardWidth = Math.min(600, width * 0.7); // 2倍の大きさ
      boardHeight = boardWidth * 0.6; // 横長
    } else {
      boardWidth = Math.min(300, width * 0.35); // 標準
      boardHeight = boardWidth * 0.85;
    }

    const marginX = width * 0.05;
    const marginY = height * 0.05;
    const startX = width - boardWidth - marginX;
    const startY = height - boardHeight - marginY;

    // Background
    ctx.fillStyle = "#1a4f32";
    ctx.fillRect(startX, startY, boardWidth, boardHeight);

    // Border
    ctx.strokeStyle = "#8b5a2b";
    ctx.lineWidth = Math.max(2, boardWidth * 0.015);
    ctx.strokeRect(startX, startY, boardWidth, boardHeight);

    // Grid Lines for Large Blackboard
    if (blackboardType === "large") {
      ctx.strokeStyle = "rgba(255,255,255,0.3)";
      ctx.lineWidth = 1;
      // Vertical line splitting text and image
      const splitX = startX + boardWidth * 0.45;
      ctx.beginPath();
      ctx.moveTo(splitX, startY);
      ctx.lineTo(splitX, startY + boardHeight);
      ctx.stroke();

      // Draw Selected Image on the right side if exists
      if (blackboardImageElement.current) {
        const imgX = splitX + boardWidth * 0.02;
        const imgY = startY + boardHeight * 0.05;
        const imgMaxW = boardWidth * 0.5 - boardWidth * 0.04;
        const imgMaxH = boardHeight * 0.9;
        
        const imgRatio = blackboardImageElement.current.width / blackboardImageElement.current.height;
        let drawW = imgMaxW;
        let drawH = drawW / imgRatio;
        if (drawH > imgMaxH) {
          drawH = imgMaxH;
          drawW = drawH * imgRatio;
        }

        // Center it
        const finalX = imgX + (imgMaxW - drawW) / 2;
        const finalY = imgY + (imgMaxH - drawH) / 2;

        ctx.drawImage(blackboardImageElement.current, finalX, finalY, drawW, drawH);
      } else {
        // Placeholder
        ctx.fillStyle = "rgba(255,255,255,0.1)";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = `${boardHeight * 0.08}px sans-serif`;
        ctx.fillText("画像なし", splitX + boardWidth * 0.25, startY + boardHeight / 2);
      }
    }

    // Text Settings
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    const fontSize = blackboardType === "large" ? boardHeight * 0.06 : boardHeight * 0.085;
    ctx.font = `bold ${fontSize}px sans-serif`;
    
    const paddingX = boardWidth * 0.03;
    let currentY = startY + boardHeight * 0.08;
    const lineHeight = fontSize * 1.5;
    
    // Label and Text Widths
    const labelWidth = blackboardType === "large" ? boardWidth * 0.12 : boardWidth * 0.32;
    const maxWidth = blackboardType === "large" ? boardWidth * 0.28 : boardWidth * 0.58;

    const wrapText = (text: string, x: number, y: number, maxW: number, lineH: number) => {
      const chars = text.split("");
      let line = "";
      let testY = y;
      for (let i = 0; i < chars.length; i++) {
        const testLine = line + chars[i];
        const metrics = ctx.measureText(testLine);
        if (metrics.width > maxW && i > 0) {
          ctx.fillText(line, x, testY);
          line = chars[i];
          testY += lineH;
        } else {
          line = testLine;
        }
      }
      ctx.fillText(line, x, testY);
      return testY + lineH;
    };

    ctx.fillStyle = "#ffeb3b";
    ctx.fillText("工事名:", startX + paddingX, currentY);
    ctx.fillStyle = "#ffffff";
    currentY = wrapText(constructionName || "未入力", startX + paddingX + labelWidth, currentY, maxWidth, lineHeight);
    currentY += boardHeight * 0.03;

    if (blackboardType === "large") {
      ctx.fillStyle = "#ffeb3b";
      ctx.fillText("寸　法:", startX + paddingX, currentY);
      ctx.fillStyle = "#ffffff";
      currentY = wrapText(dimensions || "未入力", startX + paddingX + labelWidth, currentY, maxWidth, lineHeight);
      currentY += boardHeight * 0.03;
    }

    ctx.fillStyle = "#ffeb3b";
    ctx.fillText("場　所:", startX + paddingX, currentY);
    ctx.fillStyle = "#ffffff";
    currentY = wrapText(address, startX + paddingX + labelWidth, currentY, maxWidth, lineHeight);
    currentY += boardHeight * 0.03;

    const now = new Date();
    ctx.fillStyle = "#ffeb3b";
    ctx.fillText("日　時:", startX + paddingX, currentY);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(now.toLocaleDateString("ja-JP"), startX + paddingX + labelWidth, currentY);
    ctx.fillText(now.toLocaleTimeString("ja-JP", { hour: '2-digit', minute: '2-digit' }), startX + paddingX + labelWidth, currentY + lineHeight);
  }, [constructionName, address, blackboardType, dimensions, selectedImageBase64]);

  // Realtime overlay loop
  const updateOverlay = useCallback(() => {
    if (activeTab === "camera" && overlayCanvasRef.current && webcamRef.current?.video) {
      const video = webcamRef.current.video;
      const canvas = overlayCanvasRef.current;
      
      if (canvas.width !== video.clientWidth || canvas.height !== video.clientHeight) {
        canvas.width = video.clientWidth;
        canvas.height = video.clientHeight;
      }
      
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (!showBlackboard) {
        requestRef.current = requestAnimationFrame(updateOverlay);
        return;
      }

      drawBlackboard(ctx, canvas.width, canvas.height, 1);
    }
    requestRef.current = requestAnimationFrame(updateOverlay);
  }, [activeTab, drawBlackboard, showBlackboard]);

  useEffect(() => {
    requestRef.current = requestAnimationFrame(updateOverlay);
    return () => cancelAnimationFrame(requestRef.current!);
  }, [updateOverlay]);

  const playShutterSound = () => {
    try {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.type = "square";
      osc.frequency.setValueAtTime(800, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + 0.1);
      
      gain.gain.setValueAtTime(0.5, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
      
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.1);
    } catch (e) {
      console.log("Audio not supported");
    }
  };

  const handleZoomChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    setZoomLevel(val);
    
    if (webcamRef.current?.video?.srcObject) {
      const stream = webcamRef.current.video.srcObject as MediaStream;
      const track = stream.getVideoTracks()[0];
      const capabilities = track.getCapabilities ? track.getCapabilities() : {};
      
      try {
        if (capabilities.zoom) {
          setMaxZoom(capabilities.zoom.max || 3);
          track.applyConstraints({ advanced: [{ zoom: val }] });
        } else {
          setIsZoomSupported(false);
        }
      } catch (err) {
        setIsZoomSupported(false);
        console.warn("Zoom not supported", err);
      }
    }
  };

  const capture = useCallback(() => {
    if (!webcamRef.current) {
      alert("カメラの初期化に失敗しました。ページを再読み込みしてください。");
      return;
    }
    if (capturedImages.length >= 10) {
      alert("写真は最大10枚までです。");
      return;
    }
    
    const imageSrc = webcamRef.current.getScreenshot();
    if (!imageSrc) {
      alert("カメラ映像が取得できませんでした。");
      return;
    }

    playShutterSound();

    const img = new Image();
    img.onload = () => {
      try {
        const MAX_WIDTH = 1280;
        let w = img.width;
        let h = img.height;
        if (w > MAX_WIDTH) {
          h = Math.round((h * MAX_WIDTH) / w);
          w = MAX_WIDTH;
        }

        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        if (showBlackboard) {
          drawBlackboard(ctx, w, h, 1);
        }

        const finalImage = canvas.toDataURL("image/jpeg", 0.9);
        setCapturedImages(prev => [...prev, finalImage]);
      } catch (e: any) {
        alert("画像の生成中にエラーが発生しました: " + e.message);
      }
    };
    img.onerror = () => {
      alert("撮影した画像の読み込みに失敗しました。");
    };
    img.src = imageSrc;
  }, [webcamRef, capturedImages, drawBlackboard]);

  const handleNativeCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (capturedImages.length >= 10) {
      alert("写真は最大10枚までです。");
      return;
    }
    const file = e.target.files?.[0];
    if (!file) return;

    playShutterSound();
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const MAX_WIDTH = 1280;
        let w = img.width;
        let h = img.height;
        if (w > MAX_WIDTH) {
          h = Math.round((h * MAX_WIDTH) / w);
          w = MAX_WIDTH;
        }

        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        drawBlackboard(ctx, w, h);
        
        const finalImage = canvas.toDataURL("image/jpeg", 0.9);
        setCapturedImages(prev => [...prev, finalImage]);
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const syncToGoogle = async (isTextOnly: boolean = false) => {
    if (!session) {
      alert("Googleにログインしてください");
      signIn("google");
      return;
    }
    if (!isTextOnly && capturedImages.length === 0) {
      alert("画像が撮影されていません。文字のみ保存する場合は「工事内容」タブから文字のみ保存を行ってください。");
      return;
    }

    setIsSyncing(true);
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          images: isTextOnly ? [] : capturedImages,
          constructionName,
          contractorName,
          details,
          record,
          location,
          address,
          saveFolderName: saveFolderName || constructionName
        }),
      });

      const data = await res.json();
      if (res.ok) {
        const newHistory = [{
          id: Date.now().toString(),
          constructionName: constructionName || "名称未設定",
          contractorName,
          details,
          date: new Date().toLocaleString("ja-JP"),
          fileLink: data.fileLink,
        }, ...localHistory];
        setLocalHistory(newHistory);
        localStorage.setItem("app_records_history", JSON.stringify(newHistory));
        alert("保存が完了しました！");
        
        setCapturedImages([]);
        setRecord(""); 
        
        setActiveTab("history");
        fetchDriveContents("root", "工事記録");
      } else {
        alert("エラーが発生しました: " + data.error);
      }
    } catch (error) {
      alert("通信エラーが発生しました");
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "15px" }}>
          <h1 style={{ margin: 0, fontSize: "18px" }}>現場記録アプリ</h1>
          {session ? (
            <button onClick={() => signOut()} className={`${styles.button} ${styles.secondary}`} style={{ padding: "6px 10px", fontSize: "12px" }}>
              <LogOut size={14} /> ログアウト
            </button>
          ) : (
            <button onClick={() => signIn("google")} className={styles.button} style={{ padding: "6px 10px", fontSize: "12px" }}>
              <LogIn size={14} /> ログイン
            </button>
          )}
        </div>

        {/* 3つのタブメニュー */}
        <div className={styles.tabsContainer}>
          <button onClick={() => setActiveTab("details")} className={styles.tabButton} style={{ backgroundColor: "#4caf50", color: "white", opacity: activeTab === "details" ? 1 : 0.4 }}>
            <FileText size={20} />工事内容
          </button>
          <button onClick={() => setActiveTab("history")} className={styles.tabButton} style={{ backgroundColor: "#d7ccc8", color: "#333", opacity: activeTab === "history" ? 1 : 0.4 }}>
            <History size={20} />履歴
          </button>
          <button onClick={() => setActiveTab("camera")} className={styles.tabButton} style={{ backgroundColor: "#2196f3", color: "white", opacity: activeTab === "camera" ? 1 : 0.4 }}>
            <Camera size={20} />カメラ撮影
          </button>
        </div>
      </header>

      <div className={styles.tabContent}>
        <button 
          className={styles.homeButton} 
          onClick={() => {
            if (window.confirm("最初の状態（工事内容画面）に戻りますか？")) {
              window.location.reload();
            }
          }}
          title="ホームに戻る"
        >
          <HomeIcon size={20} />
        </button>
        
        {/* === 工事内容タブ === */}
        {activeTab === "details" && (
          <div className={styles.formGroup}>
            
            {/* 新機能: 黒板タイプ選択 */}
            <div style={{ display: "flex", gap: "10px", marginBottom: "20px", backgroundColor: "#1e3a2f", padding: "10px", borderRadius: "8px", border: "1px solid #4caf50" }}>
              <button 
                style={{ flex: 1, padding: "10px", borderRadius: "6px", border: "none", backgroundColor: blackboardType === "standard" ? "#4caf50" : "#333", color: "white", fontWeight: "bold" }}
                onClick={() => setBlackboardType("standard")}
              >
                標準黒板
              </button>
              <button 
                style={{ flex: 1, padding: "10px", borderRadius: "6px", border: "none", backgroundColor: blackboardType === "large" ? "#4caf50" : "#333", color: "white", fontWeight: "bold" }}
                onClick={() => setBlackboardType("large")}
              >
                図面・寸法入り黒板(大)
              </button>
            </div>

            {blackboardType === "large" && (
              <div style={{ backgroundColor: "#2e2e2e", padding: "15px", borderRadius: "8px", marginBottom: "20px", border: "1px dashed #aaa" }}>
                <label className={styles.label} style={{ color: "#ffeb3b" }}>寸法</label>
                <input type="text" className={styles.input} value={dimensions} onChange={(e) => setDimensions(e.target.value)} placeholder="例: W800 x H600" />
                
                <label className={styles.label} style={{ color: "#ffeb3b", marginTop: "15px" }}>図面画像</label>
                <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                  <button className={`${styles.button} ${styles.secondary}`} onClick={fetchBlackboardImages} style={{ padding: "10px", fontSize: "14px", flex: 1 }}>
                    <ImageIcon size={18} /> ドライブから図面を選ぶ
                  </button>
                  {selectedImageBase64 && (
                    <button className={styles.button} style={{ padding: "10px", backgroundColor: "#e53935", flex: "none" }} onClick={() => setSelectedImageBase64(null)}>
                      <X size={18} /> 消去
                    </button>
                  )}
                </div>
                {selectedImageBase64 && (
                  <img src={selectedImageBase64} alt="Selected" style={{ width: "100%", maxHeight: "150px", objectFit: "contain", marginTop: "10px", backgroundColor: "black", borderRadius: "4px" }} />
                )}
              </div>
            )}

            {/* 新規登録 / 履歴読み込み / 定型文 ボタン */}
            <div style={{ display: "flex", gap: "10px", marginBottom: "15px", flexWrap: "wrap" }}>
              <button className={`${styles.button} ${styles.secondary}`} style={{ flex: 1, minWidth: "120px", padding: "12px", fontSize: "14px", backgroundColor: "#ff9800" }} onClick={handleNewRegistration}>
                <FilePlus size={18} /> 新規登録(クリア)
              </button>
              <button className={`${styles.button} ${styles.secondary}`} style={{ flex: 1, minWidth: "120px", padding: "12px", fontSize: "14px", backgroundColor: "#2196f3" }} onClick={() => setShowHistoryModal(true)}>
                <FolderOpen size={18} /> 履歴内容を開く
              </button>
              <button className={`${styles.button} ${styles.secondary}`} style={{ flex: 1, minWidth: "120px", padding: "12px", fontSize: "14px", backgroundColor: "#4caf50" }} onClick={() => setShowPresetModal(true)}>
                <ClipboardList size={18} /> 定型文(プリセット)
              </button>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "15px" }}>
              <p style={{ fontSize: "12px", color: "#888", margin: 0 }}>※ 文字は自動的に保存されます。</p>
              <button onClick={handleManualSave} style={{ backgroundColor: "#333", color: "white", border: "1px solid #555", borderRadius: "4px", padding: "4px 8px", fontSize: "12px", cursor: "pointer" }}>
                手動で一時保存
              </button>
            </div>
            
            {showSaveToast && (
              <div style={{ backgroundColor: "#4caf50", color: "white", padding: "8px", borderRadius: "4px", fontSize: "12px", textAlign: "center", marginBottom: "15px" }}>
                ✓ 入力内容を一時保存しました
              </div>
            )}

            <label className={styles.label}>工事名</label>
            <input type="text" className={styles.input} value={constructionName} onChange={(e) => setConstructionName(e.target.value)} placeholder="例: ○○邸新築工事" />
            
            <label className={styles.label} style={{ marginTop: "15px" }}>請負会社名</label>
            <input type="text" className={styles.input} value={contractorName} onChange={(e) => setContractorName(e.target.value)} placeholder="例: 株式会社○○工務店" />
            
            <label className={styles.label} style={{ marginTop: "15px" }}>工事内容</label>
            <textarea className={styles.textarea} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="例: 基礎配筋検査" />
            
            <div style={{ backgroundColor: "#1e3a2f", padding: "15px", borderRadius: "8px", marginTop: "20px", marginBottom: "20px", border: "1px solid #4caf50" }}>
              <label className={styles.label} style={{ color: "#81c784" }}>📁 Googleドライブ 保存先フォルダ名 (任意)</label>
              <p style={{ fontSize: "12px", color: "#ccc", margin: "0 0 8px 0" }}>※ 未入力の場合は「工事名」のフォルダに保存されます</p>
              <input type="text" className={styles.input} value={saveFolderName} onChange={(e) => setSaveFolderName(e.target.value)} placeholder={`例: ${constructionName || "フォルダ名を入力"}`} />
            </div>

            {/* 新機能: 現在地のマップ表示 */}
            <div style={{ backgroundColor: "#222", padding: "15px", borderRadius: "8px", marginBottom: "20px", border: "1px solid #444" }}>
              <label className={styles.label} style={{ display: "flex", alignItems: "center", gap: "6px", color: "#ffeb3b" }}>
                <MapPin size={18} /> 現在地の地図（自動取得）
              </label>
              <p style={{ fontSize: "12px", color: "#ccc", marginBottom: "10px", marginTop: "0" }}>{address}</p>
              {location ? (
                <MapView lat={location.lat} lng={location.lng} label={constructionName} />
              ) : (
                <div style={{ height: "150px", backgroundColor: "#333", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center", color: "#888" }}>
                  位置情報を取得中...
                </div>
              )}
            </div>

            <label className={styles.label}>工事記録</label>
            <textarea className={styles.textarea} value={record} onChange={(e) => setRecord(e.target.value)} placeholder="例: 異常なし。予定通り完了。" />
            
            <div className={styles.controls}>
              <button className={styles.button} onClick={() => setActiveTab("camera")}>
                <Camera size={20} /> カメラ撮影画面へ進む
              </button>
              <button className={`${styles.button} ${styles.secondary}`} onClick={() => syncToGoogle(true)} disabled={isSyncing}>
                <FileText size={20} /> {isSyncing ? "保存中..." : "文字のみを記録として保存する (写真なし)"}
              </button>
            </div>
          </div>
        )}

        {/* 画像選択モーダル */}
        {showDriveImageModal && (
          <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.9)", zIndex: 1000, padding: "20px", display: "flex", flexDirection: "column" }}>
            <div style={{ backgroundColor: "#222", borderRadius: "12px", padding: "20px", flex: 1, overflowY: "auto", position: "relative" }}>
              <button onClick={() => setShowDriveImageModal(false)} style={{ position: "absolute", top: "15px", right: "15px", background: "none", border: "none", color: "white", cursor: "pointer" }}>
                <X size={24} />
              </button>
              <h2 style={{ marginTop: 0, marginBottom: "5px", fontSize: "18px" }}>黒板フォルダの画像</h2>
              <p style={{ fontSize: "12px", color: "#aaa", marginBottom: "20px" }}>Googleドライブの「電気仕事/工事記録/黒板」フォルダ内の画像を表示しています</p>
              
              {isLoadingImages ? (
                <p>読み込み中...</p>
              ) : driveImages.length === 0 ? (
                <p>画像が見つかりません。ドライブの「黒板」フォルダにJPEGかPNG画像を保存してください。</p>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))", gap: "10px" }}>
                  {driveImages.map(file => (
                    <div key={file.id} onClick={() => handleSelectDriveImage(file.id)} style={{ cursor: "pointer", border: "2px solid transparent", borderRadius: "8px", overflow: "hidden" }}>
                      {file.thumbnailLink ? (
                        <img src={file.thumbnailLink} alt={file.name} style={{ width: "100%", height: "100px", objectFit: "cover" }} />
                      ) : (
                        <div style={{ width: "100%", height: "100px", backgroundColor: "#444", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <ImageIcon size={32} color="#888" />
                        </div>
                      )}
                      <div style={{ fontSize: "10px", padding: "4px", backgroundColor: "#333", color: "white", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {file.name}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 履歴内容読み込みモーダル */}
        {showHistoryModal && (
          <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.8)", zIndex: 1000, padding: "20px", display: "flex", flexDirection: "column" }}>
            <div style={{ backgroundColor: "#222", borderRadius: "12px", padding: "20px", flex: 1, overflowY: "auto", position: "relative" }}>
              <button onClick={() => setShowHistoryModal(false)} style={{ position: "absolute", top: "15px", right: "15px", background: "none", border: "none", color: "white", cursor: "pointer" }}>
                <X size={24} />
              </button>
              <h2 style={{ marginTop: 0, marginBottom: "20px", fontSize: "18px" }}>過去の履歴から読み込む</h2>
              {localHistory.length === 0 ? (
                <p>履歴がありません。</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  {localHistory.map(item => (
                    <div key={item.id} onClick={() => handleLoadFromHistory(item)} style={{ padding: "15px", backgroundColor: "#333", borderRadius: "8px", cursor: "pointer", border: "1px solid #555" }}>
                      <div style={{ fontWeight: "bold", fontSize: "16px", marginBottom: "5px", color: "#ffeb3b" }}>{item.constructionName}</div>
                      <div style={{ fontSize: "14px", color: "#ccc", marginBottom: "5px" }}>{item.contractorName || "会社名なし"}</div>
                      <div style={{ fontSize: "12px", color: "#888" }}>{item.date}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 定型文（プリセット）モーダル */}
        {showPresetModal && (
          <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.8)", zIndex: 1000, padding: "20px", display: "flex", flexDirection: "column" }}>
            <div style={{ backgroundColor: "#222", borderRadius: "12px", padding: "20px", flex: 1, overflowY: "auto", position: "relative" }}>
              <button onClick={() => setShowPresetModal(false)} style={{ position: "absolute", top: "15px", right: "15px", background: "none", border: "none", color: "white", cursor: "pointer" }}>
                <X size={24} />
              </button>
              <h2 style={{ marginTop: 0, marginBottom: "5px", fontSize: "18px" }}>定型文（プリセット）の選択・登録</h2>
              <p style={{ fontSize: "12px", color: "#aaa", marginBottom: "20px" }}>よく使う工事情報を最大10個まで登録して簡単に呼び出せます（Googleドライブ連携）</p>
              
              {!session ? (
                <div style={{ textAlign: "center", padding: "40px 20px" }}>
                  <p style={{ color: "#ff9800", marginBottom: "15px" }}>プリセット機能を利用するにはGoogleログインが必要です。</p>
                  <button onClick={() => { signIn("google"); setShowPresetModal(false); }} className={styles.button} style={{ display: "inline-flex", alignItems: "center", gap: "8px", margin: "0 auto" }}>
                    <LogIn size={18} /> Googleでログインする
                  </button>
                </div>
              ) : isLoadingPresets ? (
                <p>プリセットを読み込み中...</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  {presets.map(item => {
                    const hasData = item.constructionName || item.contractorName || item.details;
                    return (
                      <div key={item.id} style={{ padding: "15px", backgroundColor: "#333", borderRadius: "8px", border: "1px solid #555" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                          <span style={{ fontWeight: "bold", color: "#4caf50", fontSize: "14px" }}>プリセット {item.id}</span>
                          <span style={{ fontSize: "12px", color: hasData ? "#81c784" : "#888" }}>{hasData ? "登録済み" : "未登録"}</span>
                        </div>
                        {hasData ? (
                          <div style={{ marginBottom: "15px", fontSize: "14px" }}>
                            {item.constructionName && <div style={{ color: "#ffeb3b", marginBottom: "4px" }}><strong>工事名:</strong> {item.constructionName}</div>}
                            {item.contractorName && <div style={{ color: "#fff", marginBottom: "4px" }}><strong>請負会社:</strong> {item.contractorName}</div>}
                            {item.details && <div style={{ color: "#ccc", whiteSpace: "pre-wrap" }}><strong>内容:</strong> {item.details}</div>}
                          </div>
                        ) : (
                          <div style={{ color: "#666", fontSize: "13px", marginBottom: "15px", fontStyle: "italic" }}>
                            定型文が登録されていません。現在の入力内容を登録できます。
                          </div>
                        )}
                        <div style={{ display: "flex", gap: "10px" }}>
                          <button 
                            onClick={() => handleApplyPreset(item)} 
                            disabled={!hasData}
                            style={{ 
                              flex: 1, 
                              padding: "8px 10px", 
                              fontSize: "13px", 
                              backgroundColor: hasData ? "#2196f3" : "#444", 
                              color: hasData ? "white" : "#888", 
                              border: "none", 
                              borderRadius: "4px", 
                              cursor: hasData ? "pointer" : "not-allowed",
                              fontWeight: "bold"
                            }}
                          >
                            適用する
                          </button>
                          <button 
                            onClick={() => handleSavePreset(item.id)} 
                            disabled={isSavingPreset}
                            style={{ 
                              flex: 1, 
                              padding: "8px 10px", 
                              fontSize: "13px", 
                              backgroundColor: "#ff9800", 
                              color: "white", 
                              border: "none", 
                              borderRadius: "4px", 
                              cursor: "pointer",
                              fontWeight: "bold"
                            }}
                          >
                            現在値を保存
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* === カメラ撮影タブ === */}
        {activeTab === "camera" && (
          <div>
            <div className={styles.cameraLayout}>
              {/* カメラ画面エリア */}
              <div className={styles.cameraViewArea}>
                <div className={styles.cameraContainer}>
                  <Webcam
                    audio={false}
                    ref={webcamRef}
                    screenshotFormat="image/jpeg"
                    videoConstraints={videoConstraints}
                    className={styles.webcam}
                    playsInline={true}
                    forceScreenshotSourceSize={true}
                    onUserMedia={(stream) => {
                      const track = stream.getVideoTracks()[0];
                      if (track && track.getCapabilities) {
                        const capabilities = track.getCapabilities();
                        if (capabilities.zoom) {
                          setIsZoomSupported(true);
                          setMaxZoom(capabilities.zoom.max || 3);
                          try { track.applyConstraints({ advanced: [{ zoom: zoomLevel }] }); } catch(e){}
                        } else {
                          setIsZoomSupported(false);
                        }
                      }
                    }}
                  />
                  <canvas ref={overlayCanvasRef} className={styles.realtimeCanvas} />
                </div>
              </div>

              {/* 操作ボタンエリア */}
              <div className={styles.cameraControlsArea}>
                {/* ズームスライダーと黒板切替 */}
                <div style={{ padding: "10px 15px", backgroundColor: "#222", borderRadius: "8px", display: "flex", flexDirection: "column", gap: "15px" }}>
                  
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "5px" }}>
                    <span style={{ fontSize: "14px", fontWeight: "bold" }}>黒板の合成</span>
                    <button 
                      onClick={() => setShowBlackboard(!showBlackboard)}
                      style={{
                        padding: "8px 12px",
                        borderRadius: "20px",
                        border: "none",
                        backgroundColor: showBlackboard ? "#4caf50" : "#666",
                        color: "#fff",
                        fontWeight: "bold",
                        cursor: "pointer",
                        fontSize: "12px",
                        flex: 1,
                        minWidth: "100px"
                      }}
                    >
                      {showBlackboard ? "ON (表示)" : "OFF (なし)"}
                    </button>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                    <span style={{ fontSize: "14px", fontWeight: "bold" }}>ズーム: {zoomLevel.toFixed(1)}x</span>
                    {isZoomSupported ? (
                      <input 
                        type="range" 
                        min="1" 
                        max={maxZoom} 
                        step="0.1" 
                        value={zoomLevel} 
                        onChange={handleZoomChange}
                        style={{ width: "100%" }}
                      />
                    ) : (
                      <span style={{ fontSize: "11px", color: "#ff9800" }}>標準カメラからズームをご利用ください</span>
                    )}
                  </div>
                </div>

                <div className={styles.controls} style={{ margin: 0 }}>
                  <button className={styles.button} onClick={capture} disabled={capturedImages.length >= 10} style={{ padding: "15px", fontSize: "16px", width: "100%" }}>
                    <Camera size={20} /> 撮影 ({capturedImages.length}/10)
                  </button>
                </div>

                <div style={{ textAlign: "center" }}>
                  <label className={`${styles.button} ${styles.secondary}`} style={{ display: "inline-block", cursor: "pointer", padding: "10px", fontSize: "12px", backgroundColor: "#555", width: "100%", boxSizing: "border-box" }}>
                    📱 標準カメラで撮影する
                    <input 
                      type="file" 
                      accept="image/*" 
                      capture="environment" 
                      style={{ display: "none" }} 
                      onChange={handleNativeCapture}
                    />
                  </label>
                </div>
              </div>
            </div>

            {capturedImages.length > 0 && (
              <div style={{ marginTop: "20px" }}>
                <h3 style={{ margin: "0 0 10px 0", fontSize: "16px" }}>撮影済み写真 ({capturedImages.length}枚)</h3>
                <div className={styles.capturedGrid}>
                  {capturedImages.map((img, idx) => (
                    <div key={idx} className={styles.capturedImageWrapper}>
                      <img src={img} alt={`Capture ${idx+1}`} className={styles.capturedImage} />
                      <button className={styles.deleteImageButton} onClick={() => setCapturedImages(prev => prev.filter((_, i) => i !== idx))}>
                        <X size={16} />
                      </button>
                    </div>
                  ))}
                </div>
                <div className={styles.controls}>
                  <button className={`${styles.button} ${styles.success}`} onClick={() => syncToGoogle(false)} disabled={isSyncing}>
                    <Save size={20} /> {isSyncing ? "保存中..." : "保存する"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* === 履歴タブ (Google Drive Explorer) === */}
        {activeTab === "history" && (
          <div>
            {!session ? (
              <p>Googleにログインすると、Googleドライブの履歴が表示されます。</p>
            ) : (
              <div className={styles.driveExplorer}>
                <div className={styles.driveBreadcrumbs}>
                  {breadcrumbs.map((crumb, index) => (
                    <React.Fragment key={crumb.id}>
                      <span 
                        className={styles.driveCrumb} 
                        onClick={() => fetchDriveContents(crumb.id, crumb.name, crumb.level)}
                      >
                        {crumb.name}
                      </span>
                      {index < breadcrumbs.length - 1 && <ChevronRight size={16} />}
                    </React.Fragment>
                  ))}
                </div>

                {isLoadingDrive ? (
                  <p>読み込み中...</p>
                ) : driveFiles.length === 0 ? (
                  <p>フォルダは空です。</p>
                ) : (
                  driveFiles.map((file) => {
                    const isFolder = file.mimeType === "application/vnd.google-apps.folder";
                    const dateStr = file.modifiedTime ? new Date(file.modifiedTime).toLocaleString("ja-JP") : "";
                    
                    return (
                      <div key={file.id} className={styles.driveItem} onClick={() => handleDriveItemClick(file)}>
                        <div className={`${styles.driveIcon} ${isFolder ? styles.folder : styles.file}`}>
                          {isFolder ? <Folder size={24} /> : <FileSpreadsheet size={24} />}
                        </div>
                        <div className={styles.driveName}>
                          {file.name}
                          <div className={styles.driveDate}>{dateStr}</div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
