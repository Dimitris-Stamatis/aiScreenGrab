async function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(chrome.runtime.id, 1);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('files')) {
        db.createObjectStore('files', { keyPath: 'id' });
      }
    };

    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => {
      console.error("IndexedDB open error:", event.target.error);
      reject(event.target.error);
    };
  });
}
export async function saveFile(file) {
  console.log(file);
  if (!(file instanceof Blob)) {
    console.error("Attempted to save non-Blob file:", file);
    throw new TypeError("Provided file is not a Blob/File");
  }

  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('files', 'readwrite');
    const store = transaction.objectStore('files');
    const request = store.put({ id: file.name, file });

    request.onsuccess = () => resolve();
    request.onerror = (event) => {
      console.error("Error saving file to IndexedDB:", event.target.error);
      reject(event.target.error);
    };
  });
}

export async function getFile(name) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('files', 'readonly');
      const store = transaction.objectStore('files');
      const request = store.get(name);

      request.onsuccess = (event) => {
        const result = event.target.result;
        if (!result) {
          console.warn(`File not found in IndexedDB: ${name}`);
        }
        resolve(result?.file);
      };
      request.onerror = (event) => {
        console.error("Error retrieving file:", event.target.error);
        reject(event.target.error);
      };
    });
  } catch (error) {
    console.error("Failed to open DB in getFile:", error);
    throw error;
  }
}

export async function getAllFiles() {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('files', 'readonly');
      const store = transaction.objectStore('files');
      const request = store.getAll();

      request.onsuccess = (event) => {
        const result = event.target.result;
        resolve(result.map(record => record.file));
      };
      request.onerror = (event) => {
        console.error("Error retrieving all files:", event.target.error);
        reject(event.target.error);
      };
    });
  } catch (error) {
    console.error("Failed to open DB in getAllFiles:", error);
    throw error;
  }
}
