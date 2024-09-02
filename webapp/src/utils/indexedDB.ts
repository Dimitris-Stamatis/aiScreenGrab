// src/utils/indexedDB.ts
export function openDB() {
    return new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('fileStore', 1);
  
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('files')) {
          db.createObjectStore('files', { keyPath: 'id' });
        }
      };
  
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  
  export function saveFile(file: File) {
    return openDB().then(db => {
      return new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('files', 'readwrite');
        const store = transaction.objectStore('files');
        const request = store.put({ id: file.name, file });
  
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    });
  }
  
  export function getFile(name: string) {
    return openDB().then(db => {
      return new Promise<File | undefined>((resolve, reject) => {
        const transaction = db.transaction('files', 'readonly');
        const store = transaction.objectStore('files');
        const request = store.get(name);
  
        request.onsuccess = () => resolve(request.result?.file);
        request.onerror = () => reject(request.error);
      });
    });
  }
  
  export function getAllFiles() {
    return openDB().then(db => {
      return new Promise<File[]>((resolve, reject) => {
        const transaction = db.transaction('files', 'readonly');
        const store = transaction.objectStore('files');
        const request = store.getAll();
  
        request.onsuccess = () => resolve(request.result.map(record => record.file));
        request.onerror = () => reject(request.error);
      });
    });
  }
  