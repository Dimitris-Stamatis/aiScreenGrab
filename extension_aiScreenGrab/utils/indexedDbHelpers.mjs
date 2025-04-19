export async function getModelDetailsFromDB() {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction("model", "readonly");
      const store = tx.objectStore("model");
      const request = store.get("modelDetails");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
  }
  
  export async function saveModelDetailsToDB(modelDetails) {
    const db = await openDB();
    const tx = db.transaction("model", "readwrite");
    tx.objectStore("model").put(modelDetails, "modelDetails");
  }
  
  export function listenForModelDetailsChange(callback) {
    // IndexedDB doesn't have a native change listener.
    // So you can simulate one by calling this on popup close
    window.addEventListener("modelDetailsSaved", () => {
      getModelDetailsFromDB().then(callback);
    });
  }
  
  async function openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("MLStorage", 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("model")) {
          db.createObjectStore("model");
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  