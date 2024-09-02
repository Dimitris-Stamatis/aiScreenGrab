<script lang="ts">
    import { modelStore } from "../../stores";
    import { get } from 'svelte/store';
    import { onMount } from "svelte";
    import { saveFile, getAllFiles } from '../../utils/indexedDB';

const store = get(modelStore);
let modelType: string = store.modelType;
let modelFiles: File[] = store.modelFiles;
let modelParameters = store.modelParameters;

const modelParameterFields = [
  { name: 'inputShape', label: 'Input Shape' },
  { name: 'outputShape', label: 'Output Shape' },
  { name: 'numClasses', label: 'Number of Classes', type: "number" },
];

function handleFileUpload(event: Event) {
  const input = event.target as HTMLInputElement;
  if (input.files) {
    modelFiles = Array.from(input.files);
    modelStore.update(store => ({ ...store, modelFiles }));

    // Save files to IndexedDB
    modelFiles.forEach(file => {
      saveFile(file).catch(error => console.error('Failed to save file:', error));
    });
  }
}

async function loadFiles() {
  try {
    const files = await getAllFiles();
    modelFiles = files;
    modelStore.update(store => ({ ...store, modelFiles }));
  } catch (error) {
    console.error('Failed to load files:', error);
  }
}

// Load files when component mounts
onMount(() => {
  loadFiles();
});

function handleModelTypeChange(event: Event) {
  const select = event.target as HTMLSelectElement;
  modelType = select.value;
  modelStore.update(store => ({ ...store, modelType }));
}

function handleParameterChange(name: string, value: string) {
  modelParameters[name] = value;
  modelStore.update(store => ({ ...store, modelParameters }));
}

    $: console.log($modelStore);
  </script>
  <main>
    <h1>Model Upload and Configuration</h1>
  
    <section>
      <h2>Upload Model Files</h2>
      <input type="file" class="file-input" accept=".json,.bin" multiple on:change={handleFileUpload} />
        {#if modelFiles.length > 0}
          <ul>
            {#each modelFiles as file}
              <li>{file.name}</li>
            {/each}
          </ul>
        {/if}
    </section>
  
    <section>
      <h2>Model Type</h2>
      <select on:change={handleModelTypeChange}>
        <option value="graph" selected={modelType === 'graph'}>Graph Model</option>
        <option value="layer" selected={modelType === 'layer'}>Layer Model</option>
      </select>
    </section>
  
    <section>
      <h2>Model Parameters</h2>
      {#each modelParameterFields as field}
        <div class="parameter-input">
          <label for={field.name}>{field.label}</label>
          <input
            id={field.name}
            type={field.type || 'text'}
            placeholder={field.label}
            value={modelParameters[field.name]}
            on:input={event => handleParameterChange(field.name, (event.target as HTMLInputElement).value)}
          />
        </div>
      {/each}
    </section>
    </main>

    <style>
        main {
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
        }

        h1 {
            font-size: 24px;
            margin-bottom: 20px;
        }

        section {
            margin-bottom: 30px;
        }

        h2 {
            font-size: 18px;
            margin-bottom: 10px;
        }

        .file-input {
            margin-bottom: 10px;
        }

        select {
            width: 100%;
            padding: 10px;
            font-size: 16px;
            border-radius: 5px;
            border: 1px solid #ccc;
            background-color: #fff;
            margin-bottom: 10px;
        }

        .parameter-input {
            margin-bottom: 10px;
        }

        label {
            display: block;
            font-size: 16px;
            margin-bottom: 5px;
        }

        input {
            width: 100%;
            padding: 10px;
            font-size: 16px;
            border-radius: 5px;
            border: 1px solid #ccc;
            background-color: #fff;
        }

      </style>