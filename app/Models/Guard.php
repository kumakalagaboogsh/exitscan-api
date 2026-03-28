<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use App\Models\User;

class Guard extends Model
{
    use HasFactory;

    // The database table name (observed in your DB UI screenshot is `guard`)
    protected $table = 'guard';

    protected $primaryKey = 'guard_id';

    public $timestamps = false;

    protected $fillable = [
        'user_id',
        'badge_number',
        'station',
    ];

    /**
     * The user account associated with this guard record.
     */
    public function user()
    {
        // foreign key on guard table is `user_id`; user's primary key may be `user_id` as well
        return $this->belongsTo(User::class, 'user_id', (new User())->getKeyName());
    }
}
