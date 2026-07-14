<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { AppConfig, Checkout, GitBranch, GitCommit, GitFileChange, GitOperationResult, GitStatus, ProjectConfig } from '../../shared/types'

const props = defineProps<{ project: ProjectConfig; config: AppConfig }>()
const emit = defineEmits<{ saveConfig: [config: AppConfig] }>()
type GitTab = 'changes' | 'history' | 'branches' | 'worktrees'
const tab = ref<GitTab>('changes')
const checkouts = ref<Checkout[]>([])
const checkoutId = ref('')
const status = ref<GitStatus | null>(null)
const history = ref<GitCommit[]>([])
const branches = ref<GitBranch[]>([])
const selectedFile = ref<GitFileChange | null>(null)
const summary = ref('')
const description = ref('')
const branchName = ref('')
const worktreePath = ref('')
const worktreeBranch = ref('')
const createWorktreeBranch = ref(true)
const parentBranch = ref('')
const busy = ref(false)
const message = ref('')
const error = ref('')

const selectedCheckout = computed(() => checkouts.value.find((item) => item.id === checkoutId.value) ?? null)
const currentBranch = computed(() => branches.value.find((branch) => branch.current))
const localBranches = computed(() => branches.value.filter((branch) => !branch.remote && !branch.current))

async function refresh(): Promise<void> {
  busy.value = true
  error.value = ''
  try {
    checkouts.value = await window.exedeck.git.listCheckouts(props.project.id)
    if (!checkouts.value.some((item) => item.id === checkoutId.value)) {
      checkoutId.value = checkouts.value.find((item) => item.isMain)?.id ?? checkouts.value[0]?.id ?? ''
    }
    if (!checkoutId.value) { status.value = null; history.value = []; branches.value = []; return }
    ;[status.value, history.value, branches.value] = await Promise.all([
      window.exedeck.git.status(checkoutId.value),
      window.exedeck.git.history(checkoutId.value, 150),
      window.exedeck.git.branches(checkoutId.value),
    ])
    parentBranch.value = currentBranch.value ? props.project.branchParents?.[currentBranch.value.name] ?? '' : ''
    if (selectedFile.value) selectedFile.value = status.value.files.find((item) => item.path === selectedFile.value?.path) ?? null
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : 'Git data could not be loaded.'
  } finally { busy.value = false }
}

async function operate(action: () => Promise<GitOperationResult>, confirmation?: string): Promise<void> {
  if (confirmation && !window.confirm(confirmation)) return
  busy.value = true; message.value = ''; error.value = ''
  try {
    const result = await action()
    if (result.ok) message.value = result.output || 'Git operation completed.'
    else error.value = result.output || 'Git operation failed.'
    if (result.conflict) { error.value = `${error.value}\nMerge conflicts were left in Changes for you to resolve.`; tab.value = 'changes' }
    await refresh()
  } catch (caught) { error.value = caught instanceof Error ? caught.message : 'Git operation failed.' }
  finally { busy.value = false }
}

function paths(file?: GitFileChange): string[] { return file ? [file.path] : status.value?.files.map((item) => item.path) ?? [] }
async function generateMessage(): Promise<void> {
  busy.value = true; error.value = ''
  try { const generated = await window.exedeck.ai.generateCommitMessage(checkoutId.value); summary.value = generated.summary; description.value = generated.description }
  catch (caught) { error.value = caught instanceof Error ? caught.message : 'Could not generate a commit message.' }
  finally { busy.value = false }
}
async function commit(): Promise<void> {
  await operate(() => window.exedeck.git.commit(checkoutId.value, summary.value, description.value), `Create commit “${summary.value}”?`)
  if (!error.value) { summary.value = ''; description.value = '' }
}
async function createBranch(): Promise<void> {
  await operate(() => window.exedeck.git.createBranch({ checkoutId: checkoutId.value, name: branchName.value, switchTo: true }), `Create and switch to ${branchName.value}?`)
  if (!error.value) branchName.value = ''
}
async function createWorktree(): Promise<void> {
  await operate(() => window.exedeck.git.createWorktree({ projectId: props.project.id, path: worktreePath.value, branch: worktreeBranch.value, createBranch: createWorktreeBranch.value }), `Create worktree at ${worktreePath.value}?`)
  if (!error.value) { worktreePath.value = ''; worktreeBranch.value = '' }
}

function saveParent(): void {
  if (!currentBranch.value) return
  const branchParents = { ...props.project.branchParents }
  if (parentBranch.value) branchParents[currentBranch.value.name] = parentBranch.value
  else delete branchParents[currentBranch.value.name]
  emit('saveConfig', {
    ...props.config,
    projects: props.config.projects.map((project) => project.id === props.project.id ? { ...project, branchParents } : project),
  })
}

async function updateFromParent(): Promise<void> {
  if (!parentBranch.value || !status.value?.clean || !currentBranch.value) return
  await operate(
    () => window.exedeck.git.mergeBranch(checkoutId.value, parentBranch.value),
    `Merge parent ${parentBranch.value} into child ${currentBranch.value.name}? No fetch will be performed.`,
  )
}

watch(() => props.project.id, () => { checkoutId.value = ''; void refresh() })
watch(checkoutId, () => { selectedFile.value = null; void refresh() })
onMounted(() => { void refresh() })
</script>

<template>
  <section class="git-workspace">
    <header class="git-header">
      <nav class="workspace-tabs compact" aria-label="Git views">
        <button v-for="item in (['changes','history','branches','worktrees'] as GitTab[])" :key="item" type="button" :class="{ active: tab === item }" @click="tab = item">{{ item }}</button>
      </nav>
      <div class="git-context">
        <select v-model="checkoutId" aria-label="Git checkout"><option v-for="checkout in checkouts" :key="checkout.id" :value="checkout.id">{{ checkout.branch }} — {{ checkout.path }}</option></select>
        <span v-if="status" class="branch-pill">{{ status.branch }} <small v-if="status.ahead || status.behind">↑{{ status.ahead }} ↓{{ status.behind }}</small></span>
        <button type="button" class="small" :disabled="busy" @click="refresh">Refresh</button>
      </div>
    </header>
    <p v-if="message" class="operation-message" role="status">{{ message }}</p>
    <p v-if="error" class="inline-error" role="alert">{{ error }}</p>
    <div v-if="checkouts.length === 0" class="workspace-empty"><h2>Not a Git repository</h2><p>Initialize Git in the project folder to use this workspace.</p></div>

    <div v-else-if="tab === 'changes'" class="changes-layout">
      <aside class="changes-list">
        <div class="subpanel-heading"><div><span class="panel-eyebrow">Working tree</span><h2>{{ status?.files.length ?? 0 }} changes</h2></div><div class="button-row"><button class="small" :disabled="!status?.files.length" @click="operate(() => window.exedeck.git.stage(checkoutId, paths()))">Stage all</button><button class="small" @click="operate(() => window.exedeck.git.stash(checkoutId))">Stash</button><button class="small" @click="operate(() => window.exedeck.git.stashPop(checkoutId))">Pop</button></div></div>
        <button v-for="file in status?.files" :key="file.path" type="button" class="change-file" :class="{ active: selectedFile?.path === file.path, conflict: file.conflicted }" @click="selectedFile = file">
          <span class="change-code">{{ file.indexStatus }}{{ file.worktreeStatus }}</span><span><strong>{{ file.path }}</strong><small>{{ file.conflicted ? 'Conflict' : file.staged && file.unstaged ? 'Staged + unstaged' : file.staged ? 'Staged' : 'Unstaged' }}</small></span>
        </button>
        <p v-if="status?.clean" class="empty-note">Working tree clean.</p>
        <div class="commit-form">
          <input v-model="summary" type="text" placeholder="Commit summary" />
          <textarea v-model="description" placeholder="Optional description" />
          <div class="button-row"><button type="button" class="small" :disabled="busy" @click="generateMessage">Generate with AI</button><button type="button" class="small primary" :disabled="!summary.trim() || busy" @click="commit">Commit staged</button></div>
        </div>
      </aside>
      <article class="diff-view">
        <template v-if="selectedFile"><header><div><strong>{{ selectedFile.path }}</strong><span>{{ selectedFile.originalPath ? `renamed from ${selectedFile.originalPath}` : '' }}</span></div><div class="button-row"><button v-if="selectedFile.unstaged" class="small" @click="operate(() => window.exedeck.git.stage(checkoutId, paths(selectedFile)))">Stage</button><button v-if="selectedFile.staged" class="small" @click="operate(() => window.exedeck.git.unstage(checkoutId, paths(selectedFile)))">Unstage</button><button v-if="selectedFile.unstaged && !selectedFile.conflicted" class="small danger" @click="operate(() => window.exedeck.git.discard(checkoutId, paths(selectedFile)), `Discard unstaged changes in ${selectedFile.path}?`)">Discard</button></div></header><section v-if="selectedFile.stagedPatch"><h3>Staged</h3><pre>{{ selectedFile.stagedPatch }}</pre></section><section v-if="selectedFile.workingPatch"><h3>Working tree</h3><pre>{{ selectedFile.workingPatch }}</pre></section><p v-if="!selectedFile.stagedPatch && !selectedFile.workingPatch" class="empty-note">Binary, untracked, or conflict-only change. Open it in your editor to inspect.</p></template>
        <div v-else class="workspace-empty"><h2>Select a changed file</h2><p>Its staged and working-tree patches will appear here.</p></div>
      </article>
    </div>

    <div v-else-if="tab === 'history'" class="git-card-list">
      <article v-for="commitItem in history" :key="commitItem.hash" class="commit-card"><code>{{ commitItem.shortHash }}</code><div><strong>{{ commitItem.subject }}</strong><p v-if="commitItem.body">{{ commitItem.body }}</p><small>{{ commitItem.author }} · {{ new Date(commitItem.date).toLocaleString() }}</small></div><span v-if="commitItem.refs.length" class="pill">{{ commitItem.refs.join(', ') }}</span></article>
      <p v-if="history.length === 0" class="empty-note">No commits yet.</p>
    </div>

    <div v-else-if="tab === 'branches'" class="git-card-list">
      <div class="git-create-row"><input v-model="branchName" type="text" placeholder="New branch name" /><button class="primary" :disabled="!branchName.trim()" @click="createBranch">Create and switch</button><button @click="operate(() => window.exedeck.git.fetch(checkoutId))">Fetch</button><button @click="operate(() => window.exedeck.git.pull(checkoutId), 'Pull fast-forward changes into this branch?')">Pull</button><button @click="operate(() => window.exedeck.git.push(checkoutId), 'Push this branch?')">Push</button></div>
      <div v-if="currentBranch" class="parent-branch-row"><span>Child <strong>{{ currentBranch.name }}</strong></span><select v-model="parentBranch" aria-label="Parent branch"><option value="">No parent</option><option v-for="branch in localBranches" :key="branch.name" :value="branch.name">{{ branch.name }}</option></select><button @click="saveParent">Save parent</button><button class="primary" :disabled="!parentBranch || !status?.clean" :title="status?.clean ? '' : 'A clean checkout is required'" @click="updateFromParent">Update from parent</button><small>Merge only; fetch stays separate.</small></div>
      <article v-for="branch in branches" :key="branch.name" class="branch-card"><div><strong>{{ branch.name }}</strong><small>{{ branch.lastCommit }}</small></div><span v-if="branch.current" class="pill">Current</span><span v-if="branch.upstream">{{ branch.upstream }} ↑{{ branch.ahead }} ↓{{ branch.behind }}</span><div v-if="!branch.remote && !branch.current" class="button-row"><button class="small" @click="operate(() => window.exedeck.git.switchBranch(checkoutId, branch.name), `Switch this checkout to ${branch.name}?`)">Switch</button><button class="small" @click="operate(() => window.exedeck.git.mergeBranch(checkoutId, branch.name), `Merge ${branch.name} into ${currentBranch?.name}?`)">Merge</button><button class="small danger" @click="operate(() => window.exedeck.git.deleteBranch(checkoutId, branch.name), `Delete branch ${branch.name}?`)">Delete</button></div></article>
    </div>

    <div v-else class="git-card-list">
      <div class="worktree-create"><input v-model="worktreePath" type="text" placeholder="Absolute worktree path" /><input v-model="worktreeBranch" type="text" placeholder="Branch name" /><label class="inline-checkbox"><input v-model="createWorktreeBranch" type="checkbox" /> Create branch</label><button class="primary" :disabled="!worktreePath || !worktreeBranch" @click="createWorktree">Create worktree</button></div>
      <article v-for="checkout in checkouts" :key="checkout.id" class="branch-card"><div><strong>{{ checkout.branch }}</strong><small>{{ checkout.path }}</small></div><span v-if="checkout.isMain" class="pill">Project root</span><span v-if="checkout.busy" class="pill warning">In use</span><div class="button-row"><button class="small" @click="window.exedeck.git.openExternal(checkout.id, 'files')">Files</button><button class="small" @click="window.exedeck.git.openExternal(checkout.id, 'editor')">Editor</button><button class="small" @click="window.exedeck.git.openExternal(checkout.id, 'terminal')">Terminal</button><button v-if="!checkout.isMain" class="small danger" :disabled="checkout.busy" @click="operate(() => window.exedeck.git.removeWorktree(checkout.id), `Remove worktree ${checkout.path}?`)">Remove</button></div></article>
    </div>
  </section>
</template>
