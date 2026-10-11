// @별칭 IMAGES · 일정 사진 (브라우저 저장)
// (전체 지도는 D:/VibeCoding/Study_01/comments.html)
// 일정에 첨부하는 사진을 IndexedDB에 저장/조회하는 모듈.
// localStorage는 용량이 작아(보통 5~10MB) 이미지를 담기에 부적합하므로,
// localStorage(storage.js)에는 이미지의 id만 저장하고 실제 바이너리는 여기서 따로 관리한다.

(function () {
  const { generateId } = window.TripLog.util;

  const DB_NAME = "triplog-images";
  const DB_VERSION = 1;
  const STORE_NAME = "images";

  let dbPromise = null;
  const urlCache = new Map(); // id → object URL을 돌려주는 Promise

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return dbPromise;
  }

  async function saveImage(file) {
    const db = await openDb();
    const id = generateId();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put({ id, blob: file, createdAt: new Date().toISOString() });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    return id;
  }

  async function getImageBlob(id) {
    try {
      const db = await openDb();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const req = tx.objectStore(STORE_NAME).get(id);
        req.onsuccess = () => resolve(req.result ? req.result.blob : null);
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.warn("[images] 이미지를 불러오지 못했습니다.", err);
      return null;
    }
  }

  // object URL은 매번 새로 만들지 않고 캐시해서 재사용 (삭제 시 해제).
  // 같은 이미지를 동시에 여러 번 요청해도 URL이 하나만 만들어지도록 결과가 아니라 Promise를 캐시한다.
  function getImageUrl(id) {
    if (!urlCache.has(id)) {
      urlCache.set(
        id,
        getImageBlob(id).then((blob) => {
          if (blob) return URL.createObjectURL(blob);
          urlCache.delete(id); // 못 찾은 결과는 캐시하지 않는다
          return null;
        })
      );
    }
    return urlCache.get(id);
  }

  async function deleteImage(id) {
    const cached = urlCache.get(id);
    urlCache.delete(id);
    cached?.then((url) => url && URL.revokeObjectURL(url));
    try {
      const db = await openDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).delete(id);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    } catch (err) {
      console.warn("[images] 이미지 삭제 실패", err);
    }
  }

  window.TripLog = window.TripLog || {};
  window.TripLog.images = {
    saveImage,
    getImageUrl,
    deleteImage,
  };
})();
