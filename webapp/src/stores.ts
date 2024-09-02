import { writable } from "svelte/store";

export const stream = writable(<MediaStream | null>null);

interface ModelParameters {
    [key: string]: string;
    inputShape: string;
    outputShape: string;
    numClasses: string;
}

interface ModelStore {
    modelType: string;
    modelFiles: any;
    modelParameters: ModelParameters;
}

// Define the local storage key
const LOCAL_STORAGE_KEY = 'modelStore';

// Load the initial state from local storage
function loadFromLocalStorage(): ModelStore {
    if (typeof window !== 'undefined' && window.localStorage) {
        const savedState = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (savedState) {
            try {
                const parsedState = JSON.parse(savedState);
                // Check if the parsed state has the expected structure
                if (parsedState && typeof parsedState === 'object') {
                    return parsedState;
                }
            } catch (error) {
                console.error('Failed to parse saved state:', error);
            }
        }
    }
    // Return the default state if no saved state is found
    return {
        modelType: 'graph',
        modelFiles: [],
        modelParameters: {
            inputShape: "",
            outputShape: "",
            numClasses: "",
        },
    };
}

// Create a writable store with the initial state
export const modelStore = writable<ModelStore>(loadFromLocalStorage());

// Subscribe to the store and save the state to local storage whenever it changes
if (typeof window !== 'undefined' && window.localStorage) {
    modelStore.subscribe(state => {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(state));
    });
}