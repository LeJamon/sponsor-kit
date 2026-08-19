<script setup lang="ts">
import { formatDropsAsXrp } from '~/utils/format'

const capabilities = [
  { icon: 'i-lucide-send', title: 'Policy & intent', description: 'Define rules, fees, reserves and per-wallet limits.' },
  { icon: 'i-lucide-shield-check', title: 'Sponsor & submit', description: 'ACME sponsors, signs and submits to the ledger.' },
  { icon: 'i-lucide-clipboard-check', title: 'Validate & settle', description: 'The ledger validates. ACME reconciles.' },
  { icon: 'i-lucide-chart-no-axes-column-increasing', title: 'Real-time insights', description: 'Monitor usage, fees and savings in real time.' }
]

const { data: network, status: networkStatus, error: networkError, refresh: refreshNetwork } = await useFetch('/api/v1/public/network')

const ledgerIndex = computed(() => network.value?.ledgerIndex.toLocaleString() || '—')
const accountReserve = computed(() => formatDropsAsXrp(network.value?.accountReserveDrops))
const objectReserve = computed(() => formatDropsAsXrp(network.value?.objectReserveDrops))
const networkLabel = computed(() => network.value?.network
  ? `Live ${network.value.network}`
  : 'Live network')
</script>

<template>
  <div>
    <section class="acme-hero relative isolate overflow-hidden border-b border-[#D9E5F7] bg-[#F4F8FF]">
      <img
        src="/acme-sailboat-hero.webp"
        alt=""
        width="1536"
        height="1024"
        fetchpriority="high"
        class="acme-hero-image absolute inset-x-0 top-0 -z-30 h-full w-full object-cover object-[67%_center] lg:h-[900px]"
      >
      <div class="acme-hero-wash absolute inset-x-0 top-0 -z-20 h-full lg:h-[900px]" />
      <div class="acme-hero-halftone pointer-events-none absolute inset-x-0 top-0 -z-10 h-full lg:h-[900px]" />

      <UContainer class="relative flex min-h-[calc(100svh-4.5rem)] max-w-[1740px] flex-col px-6 pb-8 pt-16 sm:px-8 sm:pt-20 lg:min-h-[780px] lg:justify-between lg:pb-10 lg:pt-24 xl:px-12">
        <div class="max-w-[610px]">
          <h1 class="max-w-[600px] text-6xl font-bold leading-[.92] tracking-[-.06em] text-[#10244A] sm:text-7xl lg:text-[5.75rem]">
            <span class="block">Sponsor the</span>
            <span class="block text-[#0A3DFF]">journey<span class="text-[#10244A]">.</span></span>
          </h1>
          <p class="mt-8 max-w-[590px] text-lg leading-8 text-[#526A91] sm:text-xl sm:leading-9">
            ACME lets your product cover XRPL transaction fees and reserves while users keep complete control of their wallet keys.
          </p>
          <div class="mt-9 flex flex-wrap items-center gap-3 sm:gap-5">
            <UButton
              to="/sign-up"
              label="Get started"
              size="xl"
              class="px-7"
              trailing-icon="i-lucide-arrow-right"
            />
            <UButton
              to="/docs"
              label="Explore docs"
              size="xl"
              color="primary"
              variant="link"
              class="px-4"
              trailing-icon="i-lucide-arrow-right"
            />
          </div>
        </div>

        <div class="mt-16 overflow-hidden rounded-[1.75rem] border border-white/95 bg-white/95 shadow-[0_24px_80px_rgba(16,36,74,.16)] backdrop-blur-xl lg:mt-14 lg:grid lg:grid-cols-[1.25fr_.95fr]">
          <div class="relative grid gap-0 border-b border-[#D9E5F7] sm:grid-cols-3 lg:border-b-0 lg:border-r">
            <div
              v-for="metric in [
                { icon: 'i-lucide-arrow-up-right', value: ledgerIndex, label: 'Validated ledger', detail: networkLabel },
                { icon: 'i-lucide-landmark', value: accountReserve, label: 'Account reserve', detail: 'Current network' },
                { icon: 'i-lucide-box', value: objectReserve, label: 'Object reserve', detail: 'Current network' }
              ]"
              :key="metric.label"
              class="border-b border-[#D9E5F7] p-6 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0 lg:flex lg:min-h-[290px] lg:flex-col lg:justify-center lg:p-9"
            >
              <span class="grid size-11 place-items-center rounded-full bg-[#EEF4FF] text-[#0A3DFF]">
                <UIcon
                  :name="metric.icon"
                  class="size-6"
                />
              </span>
              <p class="mt-6 text-2xl font-bold tracking-[-.035em] text-[#10244A] xl:text-[2rem]">
                {{ networkStatus === 'pending' ? '—' : metric.value }}
              </p>
              <p class="mt-2 text-sm font-semibold text-[#354D75]">
                {{ metric.label }}
              </p>
              <p class="mt-1 text-xs text-[#7B90B0]">
                {{ networkError ? 'Live data unavailable' : metric.detail }}
              </p>
            </div>
            <UButton
              v-if="networkError"
              label="Retry live data"
              size="xs"
              color="neutral"
              variant="ghost"
              class="absolute right-3 top-3"
              @click="() => refreshNetwork()"
            />
          </div>

          <div class="p-6 lg:flex lg:min-h-[290px] lg:flex-col lg:justify-center lg:p-9">
            <div class="flex items-start justify-between gap-4">
              <div>
                <p class="text-xs font-semibold text-[#7B90B0]">
                  Example transaction
                </p>
                <p class="mt-2 text-lg font-semibold text-[#10244A]">
                  Send 100 XRP
                </p>
              </div>
              <UBadge
                label="Policy approved"
                icon="i-lucide-circle-check"
                color="primary"
                variant="subtle"
              />
            </div>
            <div class="mt-5 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-t border-[#D9E5F7] pt-5 sm:gap-4">
              <div class="min-w-0">
                <p class="text-[11px] font-semibold text-[#7B90B0]">
                  FROM
                </p>
                <p class="mt-2 truncate font-mono text-sm font-semibold">
                  rUser...8F2K
                </p>
              </div>
              <span class="grid size-10 place-items-center rounded-full border border-[#D9E5F7] bg-white shadow-sm">
                <UIcon
                  name="i-lucide-arrow-right"
                  class="text-[#0A3DFF]"
                />
              </span>
              <div class="min-w-0 text-right">
                <p class="text-[11px] font-semibold text-[#7B90B0]">
                  TO
                </p>
                <p class="mt-2 truncate font-mono text-sm font-semibold">
                  rStore...72DA
                </p>
              </div>
            </div>
            <div class="mt-5 grid gap-3 sm:grid-cols-2">
              <div class="rounded-xl bg-[#F3F7FF] p-4">
                <p class="text-[11px] font-semibold text-[#7B90B0]">
                  NETWORK FEE
                </p>
                <p class="mt-2 font-semibold text-[#0A3DFF]">
                  Sponsored · {{ network?.baseFeeDrops || '—' }} drops
                </p>
              </div>
              <div class="rounded-xl bg-[#F3F7FF] p-4">
                <p class="text-[11px] font-semibold text-[#7B90B0]">
                  RESERVE IMPACT
                </p>
                <p class="mt-2 font-semibold text-[#10244A]">
                  No new object
                </p>
              </div>
            </div>
          </div>
        </div>
      </UContainer>
    </section>

    <section
      id="product"
      class="flex min-h-[calc(100svh-4.5rem)] items-center border-b border-[#E5EDF9] bg-white"
    >
      <UContainer class="grid w-full items-center gap-14 py-20 lg:grid-cols-[0.86fr_1.14fr] lg:gap-20 lg:py-24">
        <div>
          <p class="acme-kicker">
            One integration
          </p><h2 class="mt-4 max-w-lg text-4xl font-bold tracking-[-0.035em] text-[#10244A] sm:text-5xl sm:leading-[1.08]">
            The complexity stays behind the API.
          </h2><p class="mt-6 max-w-xl text-lg leading-8 text-[#62789C]">
            Give users a familiar signing flow. ACME handles policy, sponsor authorization, submission, and reconciliation.
          </p>
          <div class="mt-12 grid gap-x-10 gap-y-9 sm:grid-cols-2">
            <div
              v-for="item in capabilities"
              :key="item.title"
            >
              <div class="grid size-12 place-items-center rounded-xl border border-[#E2EBFA] bg-[#F0F6FF] text-[#0A3DFF] shadow-[0_8px_24px_rgba(61,113,196,0.08)]">
                <UIcon
                  :name="item.icon"
                  class="size-5"
                />
              </div><h3 class="mt-4 font-semibold text-[#10244A]">
                {{ item.title }}
              </h3><p class="mt-2 max-w-[16rem] text-sm leading-6 text-[#62789C]">
                {{ item.description }}
              </p>
            </div>
          </div>
        </div>

        <div
          class="relative mx-auto h-[430px] w-full max-w-[590px] sm:h-[520px]"
          role="img"
          aria-label="Your application connects to the ACME API, which communicates with the XRP Ledger"
        >
          <div class="absolute inset-x-[8%] top-[15%] h-[70%] rounded-full bg-[radial-gradient(ellipse_at_center,rgba(90,169,255,0.20),rgba(220,235,255,0.08)_45%,transparent_72%)] blur-2xl" />

          <div class="acme-stack-plane acme-stack-guide top-[29%]" />
          <div class="acme-stack-plane acme-stack-guide top-[55%]" />

          <div class="acme-stack-plane acme-stack-card top-[8%] border-[#DDE8F8] bg-white text-[#10244A]">
            <div class="flex h-full items-center justify-center gap-4 sm:gap-6">
              <span class="grid size-12 place-items-center rounded-xl bg-[#F1F6FF] text-[#0A3DFF] shadow-sm sm:size-14">
                <UIcon
                  name="i-lucide-panels-top-left"
                  class="size-6"
                />
              </span>
              <span class="text-sm font-bold tracking-[0.16em] text-[#62789C] sm:text-base">YOUR APP</span>
            </div>
          </div>

          <div class="acme-stack-plane acme-stack-card acme-stack-primary top-[36%] border-[#2862FF] bg-[#0A3DFF] text-white">
            <div class="flex h-full items-center justify-center gap-4 sm:gap-6">
              <span class="grid size-12 place-items-center rounded-xl bg-white/12 sm:size-14">
                <UIcon
                  name="i-lucide-sailboat"
                  class="size-7"
                />
              </span>
              <span class="text-sm font-bold tracking-[0.16em] sm:text-base">ACME API</span>
            </div>
          </div>

          <div class="acme-stack-plane acme-stack-card top-[64%] border-[#DDE8F8] bg-white text-[#10244A]">
            <div class="flex h-full items-center justify-center gap-4 sm:gap-6">
              <span class="grid size-12 place-items-center rounded-xl bg-[#F1F6FF] text-[#62789C] shadow-sm sm:size-14">
                <UIcon
                  name="i-lucide-network"
                  class="size-6"
                />
              </span>
              <span class="text-sm font-bold tracking-[0.16em] text-[#62789C] sm:text-base">XRPL LEDGER</span>
            </div>
          </div>
        </div>
      </UContainer>
    </section>

    <section
      id="migration"
      class="flex min-h-[calc(100svh-4.5rem)] items-center bg-white"
    >
      <UContainer class="flex w-full flex-col gap-14 py-20 lg:gap-16 lg:py-24">
        <div class="grid items-center gap-12 lg:grid-cols-[0.86fr_1.14fr] lg:gap-20">
          <div>
            <p class="acme-kicker">
              Existing wallets
            </p><h2 class="mt-4 max-w-lg text-4xl font-bold tracking-[-0.035em] text-[#10244A] sm:text-5xl sm:leading-[1.08]">
              Start where your users already are.
            </h2><p class="mt-6 max-w-xl text-lg leading-8 text-[#62789C]">
              Fee sponsorship does not require a fresh wallet. Existing account and object reserves are different: ACME inventories the ledger, identifies eligible objects, then prepares an explicit sponsorship transfer for the wallet to approve.
            </p><UButton
              to="/app/reserves/migrate"
              label="Explore reserve migration"
              size="lg"
              class="mt-7"
              trailing-icon="i-lucide-arrow-right"
            />
          </div>

          <div class="overflow-hidden rounded-2xl border border-[#1B386A] bg-[#102A55] p-5 text-white shadow-[0_28px_70px_rgba(16,36,74,0.20)] sm:p-7">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-xs font-semibold tracking-[0.12em] text-blue-200">
                  WALLET INVENTORY
                </p><p class="mt-1 font-mono text-sm">
                  rH8...2Zm
                </p>
              </div><UBadge
                label="Validated ledger"
                color="success"
              />
            </div>
            <div class="mt-7 space-y-3.5">
              <div class="flex items-center justify-between gap-4 rounded-xl border border-white/4 bg-white/7 px-5 py-4">
                <span class="font-medium">Transaction fees</span><span class="text-right text-sm font-semibold text-blue-200">Ready now</span>
              </div>
              <div class="flex items-center justify-between gap-4 rounded-xl border border-white/4 bg-white/7 px-5 py-4">
                <span class="font-medium">3 eligible objects</span><span class="text-right text-sm font-semibold text-blue-200">Transfer required</span>
              </div>
              <div class="flex items-center justify-between gap-4 rounded-xl border border-white/4 bg-white/7 px-5 py-4">
                <span class="font-medium">1 unsupported object</span><span class="text-right text-sm font-semibold text-slate-300">Unchanged</span>
              </div>
            </div>
          </div>
        </div>

        <div class="overflow-hidden rounded-3xl border border-[#DCE8FA] bg-[#EDF4FF] px-6 py-9 sm:px-10 lg:flex lg:items-center lg:justify-between lg:px-12">
          <div class="flex items-center gap-5">
            <span class="grid size-16 shrink-0 place-items-center rounded-full bg-white shadow-[0_10px_30px_rgba(43,91,165,0.10)]">
              <AppLogo compact />
            </span>
            <div>
              <p class="text-xs font-bold uppercase tracking-[0.14em] text-[#3971FF]">
                Ready to give your users a smoother start?
              </p><h2 class="mt-3 text-2xl font-bold tracking-tight text-[#10244A] sm:text-3xl">
                Give your users a smoother start.
              </h2>
            </div>
          </div><div class="mt-7 lg:mt-0 lg:pl-8">
            <UButton
              to="/sign-up"
              label="Create a project"
              size="lg"
              trailing-icon="i-lucide-arrow-right"
            />
          </div>
        </div>
      </UContainer>
    </section>
  </div>
</template>

<style scoped>
.acme-hero-image {
  filter: grayscale(1) sepia(1) saturate(6) hue-rotate(181deg) contrast(1.08) brightness(1.08);
}

.acme-hero-wash {
  background:
    linear-gradient(90deg, rgb(255 255 255 / 100%) 0%, rgb(255 255 255 / 96%) 28%, rgb(255 255 255 / 55%) 49%, rgb(255 255 255 / 4%) 74%),
    linear-gradient(0deg, rgb(240 246 255 / 28%), transparent 42%);
}

.acme-hero-halftone {
  background-image: radial-gradient(circle, rgb(10 61 255 / 24%) .65px, transparent .8px);
  background-size: 4px 4px;
  mix-blend-mode: multiply;
  -webkit-mask-image: linear-gradient(90deg, transparent 12%, rgb(0 0 0 / 28%) 37%, #000 58%);
  mask-image: linear-gradient(90deg, transparent 12%, rgb(0 0 0 / 28%) 37%, #000 58%);
}

.acme-stack-plane {
  position: absolute;
  left: 12%;
  width: 76%;
  height: 29%;
  border-radius: 1.4rem;
  transform: perspective(1100px) rotateX(56deg) rotateZ(-30deg);
  transform-origin: center;
}

.acme-stack-guide {
  z-index: 1;
  border: 2px dashed rgb(147 185 255 / 58%);
  background: rgb(235 244 255 / 18%);
}

.acme-stack-card {
  z-index: 2;
  overflow: hidden;
  border-width: 1px;
  box-shadow:
    0 30px 50px rgb(53 94 155 / 12%),
    0 8px 18px rgb(53 94 155 / 8%);
}

.acme-stack-primary {
  z-index: 3;
  box-shadow:
    0 36px 62px rgb(10 61 255 / 28%),
    0 12px 24px rgb(10 61 255 / 18%);
}

@media (max-width: 639px) {
  .acme-hero-image {
    object-position: 64% center;
    opacity: .55;
  }

  .acme-hero-wash {
    background:
      linear-gradient(180deg, rgb(255 255 255 / 100%) 0%, rgb(255 255 255 / 93%) 42%, rgb(255 255 255 / 52%) 68%, rgb(240 246 255 / 50%) 100%),
      linear-gradient(90deg, rgb(255 255 255 / 88%), transparent);
  }

  .acme-hero-halftone {
    -webkit-mask-image: linear-gradient(180deg, transparent 20%, #000 58%);
    mask-image: linear-gradient(180deg, transparent 20%, #000 58%);
  }

  .acme-stack-plane {
    left: 9%;
    width: 82%;
    border-radius: 1rem;
  }
}
</style>
