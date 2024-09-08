async function openDB() {
  return new Promise ((resolve, reject) => {
    const request = indexedDB.open(chrome.runtime.id, 1);

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

export async function saveFile(file) {
  return openDB().then(db => {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('files', 'readwrite');
      const store = transaction.objectStore('files');
      const request = store.put({ id: file.name, file });
console.log(file);
console.log(chrome.runtime.id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  });
}

export async function getFile(name) {
  return openDB().then(db => {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('files', 'readonly');
      const store = transaction.objectStore('files');
      const request = store.get(name);

      request.onsuccess = () => resolve(request.result?.file);
      request.onerror = () => reject(request.error);
    });
  });
}

export async function getAllFiles() {
  return openDB().then(db => {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('files', 'readonly');
      const store = transaction.objectStore('files');
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result.map(record => record.file));
      request.onerror = () => reject(request.error);
    });
  });
}