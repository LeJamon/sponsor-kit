<template>
  <div class="min-h-screen bg-[#EEF4FC] p-3 sm:p-5 lg:p-8">
    <div class="mx-auto grid min-h-[calc(100vh-1.5rem)] max-w-[1480px] overflow-hidden rounded-[1.75rem] border border-[#D9E5F7] bg-white shadow-[0_28px_80px_rgba(32,82,170,0.14)] sm:min-h-[calc(100vh-2.5rem)] lg:min-h-[calc(100vh-4rem)] lg:grid-cols-[minmax(440px,0.88fr)_minmax(0,1.12fr)]">
      <section class="flex min-w-0 flex-col bg-white">
        <main class="flex flex-1 items-start px-5 py-7 sm:px-10 sm:py-10 lg:items-center lg:px-12 xl:px-20">
          <slot />
        </main>
        <footer class="flex flex-col gap-3 border-t border-[#EEF3FA] px-5 py-5 text-xs text-[#62789C] sm:flex-row sm:items-center sm:justify-between sm:px-10 lg:px-12 xl:px-20">
          <nav
            aria-label="Account links"
            class="flex items-center gap-4"
          >
            <NuxtLink
              to="/docs"
              class="transition-colors hover:text-[#0A3DFF]"
            >Docs</NuxtLink>
            <NuxtLink
              to="/status"
              class="transition-colors hover:text-[#0A3DFF]"
            >Status</NuxtLink>
          </nav>
          <span>© {{ new Date().getFullYear() }} ACME</span>
        </footer>
      </section>

      <aside
        class="relative hidden min-h-[720px] overflow-hidden lg:flex"
        aria-labelledby="auth-art-heading"
      >
        <picture class="absolute inset-0">
          <source
            srcset="/boat.webp"
            type="image/webp"
          >
          <img
            src="/boat.png"
            alt="A blue sailboat crossing open water"
            class="h-full w-full object-cover object-[68%_70%]"
            decoding="async"
          >
        </picture>
        <div class="absolute inset-0 bg-gradient-to-t from-[#08152E]/80 via-[#08152E]/10 to-white/10" />
        <div class="absolute inset-0 bg-gradient-to-r from-white/20 via-transparent to-[#0A3DFF]/10" />
        <div class="relative flex min-h-full flex-col justify-between p-8 xl:p-12">
          <p class="w-fit rounded-full border border-white/70 bg-white/75 px-3.5 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#10244A] shadow-sm backdrop-blur-sm">
            XRPL sponsorship infrastructure
          </p>
          <div class="max-w-md text-white">
            <p class="text-xs font-semibold uppercase tracking-[0.2em] text-white/75">
              ACME developer console
            </p>
            <h2
              id="auth-art-heading"
              class="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl"
            >
              Keep your next project moving.
            </h2>
            <p class="mt-4 max-w-sm text-sm leading-6 text-white/80 sm:text-base">
              Policy-controlled fee and reserve sponsorship for XRPL applications.
            </p>
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>
