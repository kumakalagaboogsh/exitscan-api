<?php

use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return view('welcome');
});

Route::get('/admin/dashboard', function () {
    return view('admin.dashboard');
});

Route::get('/admin/visitor', function () {
    return view('admin.visitor');
});

Route::get('/admin/alerts', function () {
    return view('admin.alert');
});

Route::get('/admin/user', function () {
    return view('admin.user');
});
