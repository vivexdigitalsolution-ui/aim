<template>
  <input ref="el" :value="text" :inputmode="decimal ? 'decimal' : 'numeric'" autocomplete="off" :disabled="disabled" @input="onInput" @blur="onBlur" />
</template>

<script setup lang="ts">
// A number box that puts the thousands commas in WHILE you type (1234567 shows as 1,234,567). The page still gets a plain number (or null when empty).
//   <NumInput v-model="price" />          whole numbers          <NumInput v-model="rate" decimal />     also a decimal part (0.0285)
const props = defineProps<{ modelValue?: number | null; decimal?: boolean; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: number | null] }>()
const el = ref<HTMLInputElement | null>(null)

/** "1234567.5" -> "1,234,567.5"; keeps a trailing "." while typing a decimal */
function format(raw: string): string {
  let s = raw.replace(props.decimal ? /[^\d.]/g : /[^\d]/g, '')
  let dec = ''
  if (props.decimal) { const i = s.indexOf('.'); if (i >= 0) { dec = '.' + s.slice(i + 1).replace(/\./g, ''); s = s.slice(0, i) } }
  s = s.replace(/^0+(?=\d)/, '')
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + dec
}
const toNum = (t: string): number | null => { const c = t.replace(/,/g, ''); return c === '' || c === '.' ? null : Number(c) }
const show = (v: number | null | undefined) => (v === null || v === undefined || Number.isNaN(v) ? '' : format(String(v)))
const text = ref(show(props.modelValue))

function onInput(e: Event) {
  const input = e.target as HTMLInputElement
  const before = input.value.slice(0, input.selectionStart ?? input.value.length)
  const digitsBefore = before.replace(/[^\d.]/g, '').length          // where the caret is, counted in digits, so it survives the commas moving
  text.value = format(input.value)
  input.value = text.value
  let pos = 0, seen = 0
  while (pos < text.value.length && seen < digitsBefore) { if (/[\d.]/.test(text.value[pos]!)) seen++; pos++ }
  input.setSelectionRange(pos, pos)
  emit('update:modelValue', toNum(text.value))
}
function onBlur() { text.value = show(toNum(text.value)) }
// the page changed the number (a button, a currency switch): show it
watch(() => props.modelValue, (v) => { if (toNum(text.value) !== (v ?? null)) text.value = show(v) })
</script>
