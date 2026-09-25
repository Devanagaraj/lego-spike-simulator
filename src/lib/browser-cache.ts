const databaseName = 'lego-spike-simulator';
const storeName = 'assets';

function openCache(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(databaseName, 1);
        request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains(storeName)) {
                request.result.createObjectStore(storeName);
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

export async function readCache<T>(key: string): Promise<T | undefined> {
    const database = await openCache();
    return new Promise((resolve, reject) => {
        const transaction = database.transaction(storeName, 'readonly');
        const request = transaction.objectStore(storeName).get(key);
        transaction.oncomplete = () => {
            database.close();
            resolve(request.result as T | undefined);
        };
        transaction.onerror = () => {
            database.close();
            reject(transaction.error);
        };
    });
}

export async function writeCache<T>(key: string, value: T): Promise<void> {
    const database = await openCache();
    return new Promise((resolve, reject) => {
        const transaction = database.transaction(storeName, 'readwrite');
        transaction.objectStore(storeName).put(value, key);
        transaction.oncomplete = () => {
            database.close();
            resolve();
        };
        transaction.onerror = () => {
            database.close();
            reject(transaction.error);
        };
    });
}
